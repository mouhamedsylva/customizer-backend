/**
 * Redessine, DANS LA BONNE POLICE, les textes d'une commande passée.
 *
 *   node dist/scripts/corriger-texte-commande.js --commande 20285            à blanc
 *   node dist/scripts/corriger-texte-commande.js --commande 20285 --ecrire   corrige
 *
 * POURQUOI : avant le 27/09/2026, le visuel PNG d'un texte était dessiné par
 * le serveur avec `<text font-family="…">`. Le moteur de rendu ne connaît que
 * les polices installées sur le système, pas les .ttf du projet : « Courgette »
 * sortait en sans-serif par défaut, sur la vignette comme sur la planche. Le
 * fichier de découpe SVG, lui, manquait souvent (vectorisation alors en échec).
 *
 * CORRECTION : la typo de chaque ligne est relue dans ses propriétés
 * (`_TexteFontFamily`, `_TexteFontSize`, `_TexteColor`…), le texte dans
 * `Personne` (commande de groupe) ou `_TexteContenu`. Le service ACTUEL trace
 * le SVG en tracés réels de la police, puis le PNG depuis ce SVG. Les deux sont
 * déposés sur Cloudinary et rangés dans `typoRetrouvee[ligne][zone]`
 * (`svgPropre`, `pngPropre`) : dashboard, fiche de production et archive ZIP
 * les servent à la place des originaux. La commande Shopify n'est PAS modifiée.
 *
 * Les planches d'aperçu (image figée de tout le vêtement) ne peuvent pas être
 * recomposées : le dashboard y affiche un avertissement.
 *
 * Prérequis : MYSQL_URL / CLOUDINARY_* dans l'environnement, colonne
 * `orders.typoRetrouvee`. L'application n'est pas démarrée.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { v2 as cloudinary } from 'cloudinary';
import { Order } from '../database/entities/order.entity';
import { TextOutlineService } from '../shared/text-outline.service';
import { TextSvgService } from '../shared/text-svg.service';
import { CloudinaryService } from '../shared/cloudinary.service';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
} catch {
  /* variables déjà dans l'environnement (docker compose) */
}

const PLACEMENTS: Record<string, string> = { f: 'front', fr: 'chest-right', b: 'back' };

/** « rgb(255, 255, 255) » ou « #fff » → « #ffffff » ; repli noir. */
export function couleurHex(c: string): string {
  const s = String(c || '').trim();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (rgb) {
    return '#' + rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  }
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map((x) => x + x).join('').toLowerCase();
  return '#000000';
}

/** Texte et typo d'une ligne de commande, ou null s'il n'y a pas de texte exploitable. */
export function texteDeLigne(props: Array<{ name: string; value: string }>): {
  zone: string;
  texte: string;
  police: string;
  taillePx: number;
  graisse: string;
  italique: boolean;
  souligne: boolean;
  couleur: string;
} | null {
  const val = (n: string) => String(props.find((p) => p.name === n)?.value ?? '').trim();
  const police = val('_TexteFontFamily').split(',')[0].replace(/['"]/g, '').trim();
  const texte = val('_TexteContenu') || val('Personne') || val('Nom / réf.');
  if (!police || !texte) return null;
  const zone = ['f', 'fr', 'b'].includes(val('_TexteZone')) ? val('_TexteZone') : 'f';
  return {
    zone,
    texte,
    police,
    taillePx: parseFloat(val('_TexteFontSize')) || 20,
    graisse: val('_TexteFontWeight') || '400',
    italique: val('_TexteFontStyle') === 'italic',
    souligne: /underline/.test(val('_TexteDecoration')),
    couleur: couleurHex(val('_TexteColor')),
  };
}

async function main(): Promise<void> {
  const ecrire = process.argv.includes('--ecrire');
  const i = process.argv.indexOf('--commande');
  const numero = i > 0 ? String(process.argv[i + 1] || '').replace(/^#/, '') : '';
  if (!numero) throw new Error('Précisez la commande : --commande 20285');

  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('MYSQL_URL ou DATABASE_URL manquant.');
  if (ecrire && !process.env.CLOUDINARY_CLOUD_NAME) {
    throw new Error('CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET requis pour --ecrire.');
  }

  const base = new DataSource({ type: 'mysql', url, entities: [Order], charset: 'utf8mb4', synchronize: false });
  await base.initialize();
  const depot = base.getRepository(Order);

  const silencieux = { log() {}, debug() {}, warn() {}, error() {} };
  const outline = new TextOutlineService();
  (outline as any).logger = silencieux;
  const rendu = new TextSvgService();
  (rendu as any).logger = silencieux;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  const nuage = new CloudinaryService({ get: (k: string) => process.env[k] } as any);

  const commandes = await depot.find({
    where: [{ orderNumber: `#${numero}` }, { orderNumber: numero }, { shopifyOrderId: numero }],
  });
  if (!commandes.length) throw new Error(`Commande ${numero} introuvable.`);

  for (const o of commandes) {
    const lignes: any[] = Array.isArray(o.lineItems) ? o.lineItems : [];
    const resultat: Record<string, Record<string, any>> = { ...(o.typoRetrouvee || {}) };
    let corrigees = 0;
    console.log(`\nCommande ${o.orderNumber ?? o.shopifyOrderId} — ${lignes.length} ligne(s)`);

    for (let n = 0; n < lignes.length; n++) {
      const props = Array.isArray(lignes[n]?.properties) ? lignes[n].properties : [];
      const t = texteDeLigne(props);
      if (!t) {
        console.log(`  ligne ${n + 1} : pas de texte, ignorée`);
        continue;
      }
      const desc = `« ${t.texte} » · ${t.police} · ${t.taillePx} px · ${t.couleur}`;
      const segments = [{
        text: t.texte,
        fontFamily: t.police,
        fontSize: t.taillePx,
        fontWeight: t.graisse,
        fontStyle: t.italique ? 'italic' : 'normal',
        color: t.couleur,
        underline: t.souligne,
      }];
      const svg = await outline.genererSvgVectoriel(segments as any, { scale: 4, padding: 32 });
      if (!svg) {
        console.log(`  ligne ${n + 1} : ${desc} → police non vectorisable, à refaire à la main`);
        continue;
      }
      if (!ecrire) {
        console.log(`  ligne ${n + 1} : ${desc} → serait redessiné (SVG + PNG)`);
        continue;
      }
      const png = await rendu.renderSvgToPng(svg, { scale: 4, padding: 32 });
      const place = PLACEMENTS[t.zone] || 'front';
      const [depotPng, depotSvg] = await Promise.all([
        nuage.uploadTextAsset(png, 'regenere', place),
        nuage.uploadTextSvgVector(svg, 'regenere', place),
      ]);
      resultat[n] = {
        ...(resultat[n] || {}),
        [t.zone]: {
          ...(resultat[n]?.[t.zone] || {}),
          texte: t.texte,
          police: t.police,
          taillePx: t.taillePx,
          couleur: t.couleur,
          souligne: t.souligne,
          source: 'regenere',
          pngPropre: depotPng.url,
          svgPropre: depotSvg.url,
        },
      };
      corrigees++;
      console.log(`  ligne ${n + 1} : ${desc}\n      PNG ${depotPng.url}\n      SVG ${depotSvg.url}`);
    }

    if (ecrire && corrigees) {
      // `update` sur la seule colonne : rien d'autre de la commande n'est touché.
      await depot.update({ shopifyOrderId: o.shopifyOrderId }, { typoRetrouvee: resultat as any });
      console.log(`  → ${corrigees} ligne(s) corrigée(s) et enregistrée(s).`);
    } else if (!ecrire) {
      console.log('  À BLANC : rien n’a été écrit. Relancez avec --ecrire pour corriger.');
    }
  }
  await base.destroy();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
