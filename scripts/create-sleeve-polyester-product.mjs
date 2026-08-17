/**
 * Répartit les variants du supplément manches sur DEUX produits, pour tenir
 * sous la limite Shopify de 100 variants par produit (plan Basic ; 2048 sur
 * Plus seulement).
 *
 *   « Personnalisation manche »              sweatshirt + t-shirt coton  (80)
 *   « Personnalisation manche - Polyester »  t-shirt polyester           (40)
 *
 * Pourquoi ce découpage : 3 textiles × 40 couleurs = 120 combinaisons, soit 20
 * de trop. La création initiale a donc été tronquée SILENCIEUSEMENT par
 * Shopify — l'API a répondu « 120 créés » alors que seuls 100 existaient, le
 * polyester s'arrêtant à 20 couleurs sur 40.
 *
 * Le polyester est retiré du produit principal plutôt que complété ailleurs :
 * un textile réparti sur deux produits serait une source d'erreur durable.
 *
 * Utilisation (depuis customizer-backend/) :
 *   node scripts/create-sleeve-polyester-product.mjs          # aperçu
 *   node scripts/create-sleeve-polyester-product.mjs --apply  # applique
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COULEURS, TEXTILES, fichiersImage, verifier } from './couleurs-textiles.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(__dirname, '..', '..');
const ASSETS = path.join(RACINE, 'Configurateur-travail', 'assets');

const _err = verifier();
if (_err.length) {
  console.error('❌ couleurs-textiles.mjs incohérent :');
  _err.forEach((e) => console.error('   - ' + e));
  process.exit(1);
}

const env = {};
const ENV_PATH = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_PATH)) {
  fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach((l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  });
}
const STORE = env.SHOPIFY_STORE_URL;
const API_VERSION = env.SHOPIFY_API_VERSION || '2024-01';
const APPLY = process.argv.includes('--apply');

const HANDLE_PRINCIPAL = 'personnalisation-manche';
const HANDLE_POLY = 'personnalisation-manche-polyester';
const TITRE_POLY = 'Personnalisation manche - Polyester';
const POLY = TEXTILES.tshirt_polyester;

let jeton = null;
async function getJeton() {
  if (jeton) return jeton;
  const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) {
    console.error('❌ OAuth échoué (HTTP ' + r.status + ')');
    process.exit(1);
  }
  jeton = d.access_token;
  return jeton;
}

async function api(chemin, options = {}) {
  const t = await getJeton();
  const r = await fetch(`https://${STORE}/admin/api/${API_VERSION}${chemin}`, {
    ...options,
    headers: { 'X-Shopify-Access-Token': t, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch (e) { /* non JSON */ }
  return { ok: r.ok, status: r.status, json, txt };
}

/* Shopify limite à 2 req/s en REST : sans pause, les dernières écritures
   repartent en 429 et le catalogue reste à moitié construit. */
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Plan ─────────────────────────────────────────────────────────────────── */
const planPoly = COULEURS.map((c) => {
  const candidats = fichiersImage(POLY.prefix, c, 'cote');
  const trouve = candidats.find((n) => fs.existsSync(path.join(ASSETS, n)));
  return { couleur: c.nom, image: trouve || null };
});

const sansImage = planPoly.filter((p) => !p.image);

console.log('');
console.log('  Produit à créer : ' + TITRE_POLY);
console.log('  Variants        : ' + planPoly.length + ' (couleurs du polyester)');
console.log('  Images de côté  : ' + (planPoly.length - sansImage.length) + '/' + planPoly.length);
console.log('  Nettoyage       : retrait des variants polyester du produit principal');
console.log('');

if (!APPLY) {
  console.log('  Aperçu — aucune écriture. Extrait :');
  planPoly.slice(0, 4).forEach((p) => {
    console.log('    ' + p.couleur.padEnd(22) + ' → ' + (p.image || '(aucune)'));
  });
  console.log('    …');
  console.log('');
  console.log('  Relancer avec --apply pour appliquer.');
  process.exit(0);
}

/* ── 1) Créer le produit polyester ───────────────────────────────────────── */
const existe = await api(`/products.json?handle=${HANDLE_POLY}&limit=1`);
let produitPoly = existe.json && existe.json.products && existe.json.products[0];

if (produitPoly) {
  console.log('  Produit polyester déjà présent (id ' + produitPoly.id + ') — variants remplacés');
  const maj = await api(`/products/${produitPoly.id}.json`, {
    method: 'PUT',
    body: JSON.stringify({
      product: {
        id: produitPoly.id,
        options: [{ name: 'Couleur' }],
        variants: planPoly.map((p) => ({
          option1: p.couleur, price: '4.00',
          inventory_management: null, requires_shipping: false, taxable: true
        }))
      }
    })
  });
  if (!maj.ok) { console.error('❌ Mise à jour échouée : ' + maj.txt.slice(0, 300)); process.exit(1); }
  produitPoly = maj.json.product;
} else {
  const crea = await api('/products.json', {
    method: 'POST',
    body: JSON.stringify({
      product: {
        title: TITRE_POLY,
        handle: HANDLE_POLY,
        /* MASQUÉ du storefront, comme le produit principal : c'est un add-on de
           facturation, il n'a rien à faire dans le catalogue public. */
        status: 'active',
        published_scope: 'web',
        published_at: null,
        vendor: 'Custom Textile',
        product_type: 'Produit personnalisé',
        options: [{ name: 'Couleur' }],
        variants: planPoly.map((p) => ({
          option1: p.couleur, price: '4.00',
          inventory_management: null, requires_shipping: false, taxable: true
        }))
      }
    })
  });
  if (!crea.ok) { console.error('❌ Création échouée : ' + crea.txt.slice(0, 300)); process.exit(1); }
  produitPoly = crea.json.product;
  console.log('  ✅ Produit créé (id ' + produitPoly.id + ') — ' + produitPoly.variants.length + ' variants');
}

/* ── 2) Images de côté ────────────────────────────────────────────────────── */
let posees = 0, echecs = 0;
for (const p of planPoly) {
  if (!p.image) continue;
  const v = produitPoly.variants.find((x) => x.option1 === p.couleur);
  if (!v) { echecs++; continue; }
  if (v.image_id) { posees++; continue; }   // déjà pourvu : on ne réenvoie pas

  const b64 = fs.readFileSync(path.join(ASSETS, p.image)).toString('base64');
  const img = await api(`/products/${produitPoly.id}/images.json`, {
    method: 'POST',
    body: JSON.stringify({
      image: {
        attachment: b64, filename: p.image,
        alt: POLY.titre + ' — ' + p.couleur + ' (manche)',
        variant_ids: [v.id]
      }
    })
  });
  if (img.ok) { posees++; if (posees % 10 === 0) console.log('    ' + posees + '/' + planPoly.length + ' images…'); }
  else { echecs++; console.warn('    ⚠ ' + p.image + ' : HTTP ' + img.status); }
  await pause(600);
}
console.log('  ✅ ' + posees + ' images associées' + (echecs ? ', ' + echecs + ' échecs' : ''));

/* ── 3) Retirer le polyester du produit principal ────────────────────────── */
const pr = await api(`/products.json?handle=${HANDLE_PRINCIPAL}&limit=1`);
const principal = pr.json && pr.json.products && pr.json.products[0];
if (!principal) { console.error('❌ Produit principal introuvable'); process.exit(1); }

const aRetirer = principal.variants.filter((v) => v.option1 === POLY.titre);
console.log('');
console.log('  Produit principal : ' + principal.variants.length + ' variants, ' +
            aRetirer.length + ' polyester à retirer');

/* Suppression via GRAPHQL, et non REST.

   Shopify refuse explicitement le DELETE REST sur un produit de plus de 100
   variants : « Cannot perform delete variant(s) action for product with more
   than 100 variants using REST. Please use GraphQL version 2024-04 or later. »
   Toutes les suppressions repartaient donc en HTTP 422.

   bulkDelete traite en outre les 20 variants en UN appel, là où REST en
   demandait 20 espacés de 600 ms. */
const t = await getJeton();
const gid = (id) => 'gid://shopify/ProductVariant/' + id;

const gq = await fetch(`https://${STORE}/admin/api/2024-10/graphql.json`, {
  method: 'POST',
  headers: { 'X-Shopify-Access-Token': t, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `mutation supprimer($productId: ID!, $variantsIds: [ID!]!) {
      productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
        userErrors { field message }
      }
    }`,
    variables: {
      productId: 'gid://shopify/Product/' + principal.id,
      variantsIds: aRetirer.map((v) => gid(v.id))
    }
  })
});

const gr = await gq.json().catch(() => ({}));
const erreurs = gr?.data?.productVariantsBulkDelete?.userErrors || [];
if (erreurs.length) {
  console.error('  ❌ Suppression échouée :');
  erreurs.forEach((e) => console.error('     ' + e.message));
} else if (gr.errors) {
  console.error('  ❌ GraphQL : ' + JSON.stringify(gr.errors).slice(0, 250));
} else {
  console.log('  ✅ ' + aRetirer.length + ' variants polyester retirés');
}

console.log('');
console.log('  ÉTAPE SUIVANTE — remplir la table du thème :');
console.log('    node scripts/exporter-variants.mjs');
console.log('  puis injecter CONF_SLEEVE_COLOR_VARIANTS dans recapitulatif.liquid.');
