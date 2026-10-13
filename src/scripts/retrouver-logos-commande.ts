/**
 * Retrouve sur Cloudinary un LOGO ou un TEXTE envoyé par le client mais PAS
 * rattaché à sa commande, puis le rattache.
 *
 *   node dist/scripts/retrouver-logos-commande.js --commande 20091
 *       liste les logos ET textes (PNG, SVG) envoyés autour de la commande
 *
 *   … --commande 20091 --ajouter <url> --libelle "Logo cœur" [--ligne 1]
 *       rattache un LOGO à la ligne indiquée (1 par défaut)
 *
 *   … --commande 20318 --texte <urlPng> --svg <urlSvg> [--zone fr] [--ligne 1]
 *       rattache un TEXTE : son visuel, son fichier de découpe, et sa typo
 *       relue dans le SVG (police, taille, couleur)
 *
 * POURQUOI :
 *  - logos : jusqu'au 05/10/2026, les fichiers de la commande étaient collectés
 *    AVANT la fin des envois vers Cloudinary — un logo déposé juste avant le
 *    clic finissait hébergé (`customizer/logos/generic/`) sans être rattaché ;
 *  - textes : jusqu'à fin septembre 2026, le thème recevait l'URL du texte
 *    rendu par le serveur (`customizer/text/<produit>/`) mais tentait de la
 *    décoder comme une image en base64 ; l'erreur était avalée et le texte
 *    disparaissait de la commande. Les fichiers, eux, existent toujours.
 *
 * Rangement : `typoRetrouvee[ligne].__assets` (logos) et
 * `typoRetrouvee[ligne][zone]` (textes, `source: 'retrouve'`). Le dashboard, la
 * fiche de production et l'archive ZIP les affichent. La commande Shopify n'est
 * PAS modifiée.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { v2 as cloudinary } from 'cloudinary';
import { Order } from '../database/entities/order.entity';
import { TypoSvgService } from '../shared/typo-svg.service';
import { zoneDuFichierTexte } from '../shared/zones-texte';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
} catch {
  /* variables déjà dans l'environnement (docker compose) */
}

const AVANT_MS = 90 * 60 * 1000;
const APRES_MS = 10 * 60 * 1000;
const CLOUDINAIRE = /^https:\/\/res\.cloudinary\.com\//;

/** Dossiers explorés : [préfixe, type de ressource, nature]. */
const SOURCES: Array<[string, 'image' | 'raw', string]> = [
  ['customizer/logos/generic/', 'image', 'logo'],
  ['customizer/text/', 'image', 'texte PNG'],
  ['customizer/text/', 'raw', 'texte SVG'],
];

const arg = (nom: string): string | null => {
  const i = process.argv.indexOf(nom);
  return i > 0 ? String(process.argv[i + 1] ?? '') : null;
};

async function telecharger(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const t = await r.text();
    return t.length < 5_000_000 ? t : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const numero = (arg('--commande') || '').replace(/^#/, '');
  if (!numero) throw new Error('Précisez la commande : --commande 20091');
  const aAjouter = arg('--ajouter');
  const texte = arg('--texte');
  const svg = arg('--svg');
  const libelle = (arg('--libelle') || 'Logo').trim().slice(0, 60);
  const ligne = Math.max(1, parseInt(arg('--ligne') || '1', 10) || 1) - 1;

  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('MYSQL_URL ou DATABASE_URL manquant.');
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  const base = new DataSource({ type: 'mysql', url, entities: [Order], charset: 'utf8mb4', synchronize: false });
  await base.initialize();
  const depot = base.getRepository(Order);
  const o = await depot.findOne({
    where: [{ orderNumber: `#${numero}` }, { orderNumber: numero }, { shopifyOrderId: numero }],
  });
  if (!o) throw new Error(`Commande ${numero} introuvable.`);

  const lignes: any[] = Array.isArray(o.lineItems) ? o.lineItems : [];
  const t: Record<string, any> = { ...(o.typoRetrouvee || {}) };
  const enregistrer = async () => {
    // `update` sur la seule colonne : rien d'autre de la commande n'est touché.
    await depot.update({ shopifyOrderId: o.shopifyOrderId }, { typoRetrouvee: t as any });
  };

  /* ── Rattacher un LOGO ── */
  if (aAjouter) {
    if (!CLOUDINAIRE.test(aAjouter)) throw new Error('URL Cloudinary https attendue.');
    if (!lignes[ligne]) throw new Error(`La commande n'a pas de ligne ${ligne + 1}.`);
    const parLigne = { ...(t[ligne] || {}) };
    const liste: Array<{ label: string; url: string }> = Array.isArray(parLigne.__assets) ? parLigne.__assets : [];
    if (!liste.some((a) => a.url === aAjouter)) liste.push({ label: libelle, url: aAjouter });
    parLigne.__assets = liste;
    t[ligne] = parLigne;
    await enregistrer();
    console.log(`✔ « ${libelle} » rattaché à la ligne ${ligne + 1} de ${o.orderNumber} : ${aAjouter}`);
    await base.destroy();
    return;
  }

  /* ── Rattacher un TEXTE (PNG + SVG + typo relue) ── */
  if (texte) {
    if (!CLOUDINAIRE.test(texte)) throw new Error('--texte : URL Cloudinary https attendue.');
    if (svg && !CLOUDINAIRE.test(svg)) throw new Error('--svg : URL Cloudinary https attendue.');
    if (!lignes[ligne]) throw new Error(`La commande n'a pas de ligne ${ligne + 1}.`);
    const zone = arg('--zone') || zoneDuFichierTexte(texte) || zoneDuFichierTexte(svg) || 'f';
    if (!['f', 'fr', 'b'].includes(zone)) throw new Error('--zone : f, fr ou b.');

    let typo: Record<string, any> | null = null;
    if (svg) {
      const contenu = await telecharger(svg);
      if (contenu) {
        const service = new TypoSvgService();
        (service as any).logger = { log() {}, debug() {}, warn() {}, error() {} };
        typo = (await service.identifier(contenu)) as any;
      }
      if (!typo) console.log('  ⚠ typo non identifiable dans le SVG : texte rattaché sans propriétés.');
    }

    t[ligne] = {
      ...(t[ligne] || {}),
      [zone]: {
        ...(t[ligne]?.[zone] || {}),
        ...(typo || {}),
        source: 'retrouve',
        pngPropre: texte,
        ...(svg ? { svgPropre: svg } : {}),
      },
    };
    await enregistrer();
    console.log(
      `✔ texte rattaché à la ligne ${ligne + 1} (zone ${zone}) de ${o.orderNumber}` +
        (typo ? ` : « ${typo.texte} » · ${typo.police} · ${typo.taillePx} px · ${typo.couleur}` : ''),
    );
    await base.destroy();
    return;
  }

  /* ── Lister les candidats ── */
  const dejaLa = new Set<string>();
  lignes.forEach((li) =>
    (Array.isArray(li?.properties) ? li.properties : []).forEach((p: any) => dejaLa.add(String(p?.value))),
  );
  const quand = new Date(o.shopifyCreatedAt || o.receivedAt);
  const debut = new Date(quand.getTime() - AVANT_MS);
  const fin = new Date(quand.getTime() + APRES_MS);
  console.log(`Commande ${o.orderNumber} passée le ${quand.toISOString()}`);
  console.log(`Fichiers envoyés entre ${debut.toISOString()} et ${fin.toISOString()} :\n`);

  const trouves: Array<{ url: string; date: Date; nature: string; detail: string }> = [];
  for (const [prefixe, typeRessource, nature] of SOURCES) {
    let curseur: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r: any = await cloudinary.api.resources({
        type: 'upload',
        resource_type: typeRessource,
        prefix: prefixe,
        max_results: 500,
        ...(curseur ? { next_cursor: curseur } : {}),
      });
      for (const res of r.resources || []) {
        const date = new Date(res.created_at);
        if (date < debut || date > fin) continue;
        const zone = nature.startsWith('texte') ? zoneDuFichierTexte(res.public_id) : null;
        trouves.push({
          url: res.secure_url,
          date,
          nature,
          detail: zone ? `zone ${zone}` : res.width ? `${res.width}×${res.height}` : '',
        });
      }
      curseur = r.next_cursor;
      if (!curseur) break;
    }
  }

  trouves.sort((a, b) => a.date.getTime() - b.date.getTime());
  if (!trouves.length) console.log('  (aucun fichier dans cette fenêtre)');
  for (const f of trouves) {
    const marque = dejaLa.has(f.url) ? '  [déjà dans la commande]' : '';
    console.log(`  ${f.date.toISOString()}  ${f.nature.padEnd(10)} ${f.detail.padEnd(11)} ${f.url}${marque}`);
  }
  console.log(
    '\nOuvrez les URL pour identifier les bons fichiers, puis :\n' +
      `  logo  : … --commande ${numero} --ajouter "<url>" --libelle "Logo cœur"\n` +
      `  texte : … --commande ${numero} --texte "<url PNG>" --svg "<url SVG>"`,
  );
  await base.destroy();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
