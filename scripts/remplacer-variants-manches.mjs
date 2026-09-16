/**
 * Remplace les variants du produit « Personnalisation manche » (supplément
 * logo sur les manches) par les couleurs des NOUVELLES palettes.
 *
 * Pourquoi une seule option « Couleur »
 * -------------------------------------
 * Le produit croisait deux options : Textile (2 valeurs) × Couleur (40), soit
 * 80 variants. Avec trois textiles et 54 couleurs distinctes, Shopify — qui
 * crée TOUJOURS le produit cartésien complet — en fabriquerait 162, au-delà de
 * la limite de 100 variants du plan Basic. Or 79 seulement seraient utiles :
 * chaque couleur n'appartient qu'aux palettes qui la portent.
 *
 * L'option Textile est donc retirée. Elle était redondante : la ligne du
 * vêtement figure juste au-dessus dans la commande, et le prix est le même
 * (4,00 €) pour toutes les combinaisons. Ce qu'on garde, c'est ce qui varie
 * visuellement — la couleur.
 *
 * L'IMAGE de chaque variant reste celle d'un textile précis (vue de CÔTÉ, la
 * manche étant ce qu'on floque). Pour une couleur partagée par plusieurs
 * palettes, on prend le premier produit qui la porte et dont l'image existe.
 *
 * APERÇU PAR DÉFAUT. Rien n'est écrit sans `--apply`.
 *
 * Utilisation (depuis customizer-backend/) :
 *   node scripts/remplacer-variants-manches.mjs           # aperçu
 *   node scripts/remplacer-variants-manches.mjs --apply   # applique
 *
 * Jeton obtenu par échange client_id/client_secret — voir
 * remplacer-variants-palettes.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTES, TEXTILES } from './couleurs-textiles.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..');

const APPLY = process.argv.includes('--apply');
const HANDLE = 'personnalisation-manche';

function lireEnv() {
  const env = {};
  for (const ligne of fs.readFileSync(path.join(RACINE, '.env'), 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(ligne)) continue;
    const i = ligne.indexOf('=');
    if (i < 1) continue;
    env[ligne.slice(0, i).trim()] = ligne.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const ENV = lireEnv();
const STORE = ENV.SHOPIFY_STORE_URL;
const API_VERSION = ENV.SHOPIFY_API_VERSION || '2024-01';
let JETON = null;

async function obtenirJeton() {
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: ENV.SHOPIFY_CLIENT_ID,
      client_secret: ENV.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) { console.error(`❌ Jeton refusé (HTTP ${res.status})`); process.exit(1); }
  const d = await res.json();
  if (!String(d.scope || '').includes('write_products')) {
    console.error(`❌ Portée write_products absente (${d.scope})`);
    process.exit(1);
  }
  return d.access_token;
}

async function shopify(chemin, methode = 'GET', corps) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}${chemin}`, {
    method: methode,
    headers: { 'X-Shopify-Access-Token': JETON, 'Content-Type': 'application/json' },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`Shopify ${methode} ${chemin} -> ${res.status} : ${t}`);
  return t ? JSON.parse(t) : {};
}

let CHEMIN_THEME = null;
const cache = new Map();

async function trouverCheminTheme() {
  for (let i = 1; i <= 30; i++) {
    try {
      const r = await fetch(`https://${STORE}/cdn/shop/t/${i}/assets/sweatshirt-noir-cote.png`, { method: 'HEAD' });
      if (r.ok) return `t/${i}`;
    } catch { /* suivant */ }
  }
  return null;
}

async function urlAsset(fichier) {
  if (!CHEMIN_THEME) return null;
  if (cache.has(fichier)) return cache.get(fichier);
  const url = `https://${STORE}/cdn/shop/${CHEMIN_THEME}/assets/${fichier}`;
  let ok = null;
  try { const r = await fetch(url, { method: 'HEAD' }); ok = r.ok ? url : null; } catch { ok = null; }
  cache.set(fichier, ok);
  return ok;
}

/**
 * Les couleurs de toutes les palettes, dédoublonnées par NOM.
 *
 * Une couleur partagée (« Noir », « Bordeaux »…) ne donne qu'un variant : sa
 * teinte varie d'un tissu à l'autre, mais le supplément manches coûte 4 € dans
 * tous les cas, et la ligne du vêtement porte déjà la nuance exacte.
 *
 * On mémorise les produits qui la portent, pour retrouver une image de côté.
 */
function couleursDistinctes() {
  const parNom = new Map();
  for (const produit of Object.keys(PALETTES)) {
    for (const c of PALETTES[produit]) {
      if (!parNom.has(c.nom)) parNom.set(c.nom, { nom: c.nom, hex: c.hex, sources: [] });
      parNom.get(c.nom).sources.push({ produit, slug: c.slug });
    }
  }
  return [...parNom.values()];
}

(async function main() {
  JETON = await obtenirJeton();
  CHEMIN_THEME = await trouverCheminTheme();

  const couleurs = couleursDistinctes();
  console.log(`Boutique : ${STORE} (API ${API_VERSION})`);
  console.log(`Thème    : ${CHEMIN_THEME || '⚠ introuvable'}`);
  console.log(APPLY ? '⚠  MODE APPLICATION' : 'Mode APERÇU — aucune modification');
  console.log(`\n═══ Personnalisation manche — ${couleurs.length} couleurs distinctes ═══`);

  const { products } = await shopify(`/products.json?handle=${HANDLE}`);
  const produit = (products || [])[0];
  if (!produit) { console.error(`❌ produit « ${HANDLE} » introuvable`); process.exit(1); }

  console.log(`  variants actuels : ${produit.variants.length}` +
              ` (options : ${produit.options.map((o) => `${o.name}×${o.values.length}`).join(' × ')})`);
  console.log(`  variants visés   : ${couleurs.length} (option Couleur seule)`);

  const prix = produit.variants[0]?.price || '4.00';

  /* Image de CÔTÉ : c'est la manche qu'on floque. Pour une couleur partagée,
     le premier produit qui la porte et dont l'image existe fait foi. */
  const plan = [];
  let avec = 0;
  for (const c of couleurs) {
    let url = null, fichier = null;
    for (const s of c.sources) {
      const f = `${TEXTILES[s.produit].prefix}-${s.slug}-cote.png`;
      url = await urlAsset(f);
      if (url) { fichier = f; break; }
    }
    if (url) avec++;
    plan.push({ nom: c.nom, fichier, url });
  }
  console.log(`  images de côté   : ${avec}/${couleurs.length}`);
  const sans = plan.filter((p) => !p.url).map((p) => p.nom);
  if (sans.length) console.log(`    sans image : ${sans.join(', ')}`);

  if (!APPLY) {
    console.log('\n  [aperçu] rien n\'a été modifié — relancer avec --apply');
    return;
  }

  console.log('\n  → remplacement des variants…');
  await shopify(`/products/${produit.id}.json`, 'PUT', {
    product: {
      id: produit.id,
      options: [{ name: 'Couleur', values: couleurs.map((c) => c.nom) }],
      variants: couleurs.map((c) => ({
        option1: c.nom,
        price: prix,
        inventory_management: null,
        inventory_policy: 'continue',
      })),
    },
  });

  const { product: maj } = await shopify(`/products/${produit.id}.json`);
  const parNom = {};
  for (const v of maj.variants) parNom[v.option1] = v.id;

  let posees = 0;
  for (const p of plan) {
    const id = parNom[p.nom];
    if (!p.url || !id) continue;
    try {
      await shopify(`/products/${produit.id}/images.json`, 'POST', {
        image: { src: p.url, filename: p.fichier, variant_ids: [id] },
      });
      posees++;
    } catch (e) {
      console.log(`    ⚠ image ${p.nom} : ${e.message.slice(0, 80)}`);
    }
  }
  console.log(`  ✅ ${maj.variants.length} variants, ${posees} images assignées`);

  /* Table prête à coller : indexée PAR PRODUIT, comme l'attend
     sleeveVariantForItem(). Plusieurs produits peuvent pointer vers le même
     variant quand ils partagent un nom de couleur — c'est voulu. */
  const table = {};
  for (const produitCle of Object.keys(PALETTES)) {
    table[produitCle] = {};
    for (const c of PALETTES[produitCle]) {
      if (parNom[c.nom]) table[produitCle][c.nom] = parNom[c.nom];
    }
  }
  const sortie = path.join(RACINE, 'variants-manches.json');
  fs.writeFileSync(sortie, JSON.stringify(table, null, 2));
  console.log(`  → table écrite : ${sortie}`);
})().catch((e) => { console.error('❌ ' + e.message); process.exit(1); });
