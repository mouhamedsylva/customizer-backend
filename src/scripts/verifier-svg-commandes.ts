/**
 * Repère — et sur demande régénère — les SVG de découpe CORROMPUS des
 * commandes passées.
 *
 *   node dist/scripts/verifier-svg-commandes.js                    à blanc : liste
 *   node dist/scripts/verifier-svg-commandes.js --commande 20544   une commande
 *   node dist/scripts/verifier-svg-commandes.js --regenerer        régénère et écrit
 *
 * POURQUOI : avant septembre 2026, `toPathData()` d'opentype.js écrivait des
 * `NaN` dans ~10 % des tracés. Un parseur SVG abandonne le tracé à la première
 * valeur invalide : l'atelier découpait un texte amputé (« Martin » en Bungee
 * devenait un trait). Le service est corrigé, mais les fichiers déjà déposés
 * sur Cloudinary sont restés tels quels.
 *
 * RÉGÉNÉRATION : texte, police, taille et couleur sont relus dans le SVG
 * corrompu (TypoSvgService, les NaN y sont ignorés) ou repris de
 * `typoRetrouvee`, puis retracés par le service actuel. Le nouveau fichier
 * est rangé dans `typoRetrouvee[ligne][zone].svgPropre` ; dashboard et
 * archive ZIP le servent à la place de l'original. La commande Shopify n'est
 * PAS modifiée. Gras et italique restent inconnus (l'ancien code les
 * ignorait) : le dashboard le signale. Un SVG non identifiable à coup sûr est
 * seulement signalé — l'atelier le refait à la main.
 *
 * Prérequis : colonne `orders.typoRetrouvee` (migration 1759000000000), et
 * variables MYSQL_URL / CLOUDINARY_* dans l'environnement. Connexion minimale :
 * l'application n'est pas démarrée (pas de synchro ni de relance parasite).
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { v2 as cloudinary } from 'cloudinary';
import { Order } from '../database/entities/order.entity';
import { TypoSvgService } from '../shared/typo-svg.service';
import { TextOutlineService } from '../shared/text-outline.service';
import { CloudinaryService } from '../shared/cloudinary.service';
import { svgRegenere, zoneDuSvg } from '../shared/zones-texte';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
} catch {
  /* variables déjà dans l'environnement (docker compose) */
}

const PLACEMENTS: Record<string, string> = { f: 'front', fr: 'chest-right', b: 'back' };

async function telecharger(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'res.cloudinary.com') return null;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const texte = await r.text();
    return texte.length < 5_000_000 ? texte : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const regenerer = process.argv.includes('--regenerer');
  const iCommande = process.argv.indexOf('--commande');
  const numero = iCommande > 0 ? String(process.argv[iCommande + 1] || '').replace(/^#/, '') : null;

  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('MYSQL_URL ou DATABASE_URL manquant.');
  if (regenerer && !process.env.CLOUDINARY_CLOUD_NAME) {
    throw new Error('CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET requis pour --regenerer.');
  }

  const base = new DataSource({ type: 'mysql', url, entities: [Order], charset: 'utf8mb4', synchronize: false });
  await base.initialize();
  const depot = base.getRepository(Order);

  const silencieux = { log() {}, debug() {}, warn() {}, error() {} };
  const typo = new TypoSvgService();
  (typo as any).logger = silencieux;
  const outline = new TextOutlineService();
  (outline as any).logger = silencieux;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  const nuage = new CloudinaryService({ get: (k: string) => process.env[k] } as any);

  const commandes = await depot.find(numero ? { where: { orderNumber: numero } } : {});
  let sains = 0, corrompus = 0, regeneres = 0, aRefaire = 0, dejaFaits = 0, illisibles = 0;

  for (const o of commandes) {
    const lignes: any[] = Array.isArray(o.lineItems) ? o.lineItems : [];
    const resultat: Record<string, Record<string, any>> = { ...(o.typoRetrouvee || {}) };
    let modifiee = false;

    for (let i = 0; i < lignes.length; i++) {
      const props: Array<{ name: string; value: string }> = Array.isArray(lignes[i]?.properties)
        ? lignes[i].properties
        : [];
      for (const p of props) {
        const zone = zoneDuSvg(p.name);
        if (!zone) continue;
        const ref = `#${o.orderNumber ?? o.shopifyOrderId} ligne ${i + 1} ${String(p.name).replace(/^_/, '')}`;
        if (svgRegenere(resultat[i], p.name)) {
          dejaFaits++;
          continue;
        }

        const svg = await telecharger(String(p.value));
        if (!svg) {
          illisibles++;
          console.log(`  ? ${ref} : SVG inaccessible`);
          continue;
        }
        const nan = (svg.match(/NaN/g) || []).length;
        if (!nan) {
          sains++;
          continue;
        }
        corrompus++;
        console.log(`  ✗ ${ref} : ${nan} NaN — ${p.value}`);
        if (!regenerer) continue;

        const t = resultat[i]?.[zone] ?? (await typo.identifier(svg));
        if (!t) {
          aRefaire++;
          console.log(`      → non identifiable à coup sûr : à refaire à la main par l'atelier.`);
          continue;
        }
        const segments = (Array.isArray(t.segments) && t.segments.length ? t.segments : [t]).map((s: any) => ({
          text: String(s.texte ?? ''),
          fontFamily: String(s.police ?? ''),
          fontSize: Number(s.taillePx) || 20,
          fontWeight: '400',
          color: String(s.couleur || '#000000'),
          underline: !!s.souligne,
        }));
        const propre = await outline.genererSvgVectoriel(segments, { scale: 4, padding: 32 });
        if (!propre) {
          aRefaire++;
          console.log(`      → régénération impossible (police ${segments[0]?.fontFamily}) : à refaire à la main.`);
          continue;
        }
        const depose = await nuage.uploadTextSvgVector(propre, 'regenere', PLACEMENTS[zone] || 'front');
        resultat[i] = { ...(resultat[i] || {}), [zone]: { ...t, source: 'svg', svgPropre: depose.url } };
        modifiee = true;
        regeneres++;
        console.log(`      → régénéré : « ${t.texte} » · ${t.police} · ${t.taillePx} px → ${depose.url}`);
      }
    }

    if (modifiee) {
      /* `update` sur la seule colonne : rien d'autre de la commande n'est touché. */
      await depot.update({ shopifyOrderId: o.shopifyOrderId }, { typoRetrouvee: resultat as any });
    }
  }

  console.log(
    `\n  ${sains} SVG sain(s), ${corrompus} corrompu(s), ${illisibles} inaccessible(s), ${dejaFaits} déjà régénéré(s).` +
      (regenerer
        ? `\n  ${regeneres} régénéré(s), ${aRefaire} à refaire à la main.\n`
        : `\n  À BLANC : rien n'a été écrit. Relancez avec --regenerer pour corriger.\n`),
  );
  await base.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
