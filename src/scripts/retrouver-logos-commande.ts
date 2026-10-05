/**
 * Retrouve sur Cloudinary un logo envoyé par le client mais PAS rattaché à sa
 * commande, puis le rattache.
 *
 *   node dist/scripts/retrouver-logos-commande.js --commande 20091
 *       liste les logos envoyés dans l'heure et demie précédant la commande
 *   node dist/scripts/retrouver-logos-commande.js --commande 20091 \
 *       --ajouter <url> --libelle "Logo cœur" [--ligne 1]
 *       rattache ce fichier à la ligne indiquée (1 par défaut)
 *
 * POURQUOI : jusqu'au 05/10/2026, les fichiers de la commande étaient collectés
 * AVANT la fin des envois vers Cloudinary. Un logo déposé juste avant le clic
 * « Ajouter au panier » figurait sur la planche, mais pas dans les fichiers de
 * production — alors qu'il finissait bien par être hébergé, dans
 * `customizer/logos/generic/`. Ce script le retrouve par sa date d'envoi.
 *
 * Le fichier rattaché est rangé dans `typoRetrouvee[ligne].__assets` : le
 * dashboard, la fiche de production et l'archive ZIP l'affichent avec les
 * autres. La commande Shopify n'est PAS modifiée.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { v2 as cloudinary } from 'cloudinary';
import { Order } from '../database/entities/order.entity';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
} catch {
  /* variables déjà dans l'environnement (docker compose) */
}

const DOSSIER = 'customizer/logos/generic';
const AVANT_MS = 90 * 60 * 1000;
const APRES_MS = 10 * 60 * 1000;

const arg = (nom: string): string | null => {
  const i = process.argv.indexOf(nom);
  return i > 0 ? String(process.argv[i + 1] ?? '') : null;
};

async function main(): Promise<void> {
  const numero = (arg('--commande') || '').replace(/^#/, '');
  if (!numero) throw new Error('Précisez la commande : --commande 20091');
  const aAjouter = arg('--ajouter');
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
  const dejaLa = new Set<string>();
  lignes.forEach((li) =>
    (Array.isArray(li?.properties) ? li.properties : []).forEach((p: any) => dejaLa.add(String(p?.value))),
  );

  if (aAjouter) {
    if (!/^https:\/\/res\.cloudinary\.com\//.test(aAjouter)) throw new Error('URL Cloudinary https attendue.');
    if (!lignes[ligne]) throw new Error(`La commande n'a pas de ligne ${ligne + 1}.`);
    const t: Record<string, any> = { ...(o.typoRetrouvee || {}) };
    const parLigne = { ...(t[ligne] || {}) };
    const liste: Array<{ label: string; url: string }> = Array.isArray(parLigne.__assets) ? parLigne.__assets : [];
    if (!liste.some((a) => a.url === aAjouter)) liste.push({ label: libelle, url: aAjouter });
    parLigne.__assets = liste;
    t[ligne] = parLigne;
    // `update` sur la seule colonne : rien d'autre de la commande n'est touché.
    await depot.update({ shopifyOrderId: o.shopifyOrderId }, { typoRetrouvee: t as any });
    console.log(`✔ « ${libelle} » rattaché à la ligne ${ligne + 1} de ${o.orderNumber} : ${aAjouter}`);
    await base.destroy();
    return;
  }

  const quand = new Date(o.shopifyCreatedAt || o.receivedAt);
  const debut = new Date(quand.getTime() - AVANT_MS);
  const fin = new Date(quand.getTime() + APRES_MS);
  console.log(`Commande ${o.orderNumber} passée le ${quand.toISOString()}`);
  console.log(`Logos envoyés entre ${debut.toISOString()} et ${fin.toISOString()} :\n`);

  /* Le nom porte l'heure d'envoi (logo_front_<ms>) : liste du dossier, filtrée
     par date. Paginé, au plus 20 pages de 500. */
  const trouves: Array<{ url: string; date: Date; taille: string }> = [];
  let curseur: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r: any = await cloudinary.api.resources({
      type: 'upload',
      prefix: `${DOSSIER}/`,
      max_results: 500,
      ...(curseur ? { next_cursor: curseur } : {}),
    });
    for (const res of r.resources || []) {
      const date = new Date(res.created_at);
      if (date >= debut && date <= fin) {
        trouves.push({ url: res.secure_url, date, taille: `${res.width}×${res.height}` });
      }
    }
    curseur = r.next_cursor;
    if (!curseur) break;
  }

  trouves.sort((a, b) => a.date.getTime() - b.date.getTime());
  if (!trouves.length) console.log('  (aucun logo dans cette fenêtre)');
  for (const f of trouves) {
    const marque = dejaLa.has(f.url) ? '  [déjà dans la commande]' : '';
    console.log(`  ${f.date.toISOString()}  ${f.taille.padEnd(11)} ${f.url}${marque}`);
  }
  console.log(
    '\nOuvrez les URL, repérez le bon logo, puis :\n' +
      `  node dist/scripts/retrouver-logos-commande.js --commande ${numero} --ajouter <url> --libelle "Logo cœur"`,
  );
  await base.destroy();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
