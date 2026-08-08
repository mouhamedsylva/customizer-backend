/**
 * Réassigne à chaque variant couleur son image {produit}-{couleur}-face.png.
 * Utile quand les variants ont été créés avant l'ajout des images couleur
 * (ils pointaient alors vers l'image générique).
 *
 * Pour chaque couleur : crée l'image produit (depuis l'URL CDN du thème) et la
 * lie au variant correspondant. Idempotent-ish : si le variant pointe déjà vers
 * une image dont le nom contient le slug couleur, on saute.
 *
 * Utilisation (depuis customizer-backend/) :
 *   node --env-file=.env scripts/reassign-variant-images.mjs                 # dry-run tous
 *   node --env-file=.env scripts/reassign-variant-images.mjs --apply --only=tshirt
 *   node --env-file=.env scripts/reassign-variant-images.mjs --apply         # tous
 */

import { COULEURS, TEXTILES, fichiersImage, verifier } from './couleurs-textiles.mjs';

const _err = verifier();
if (_err.length) {
  console.error('❌ couleurs-textiles.mjs incohérent :');
  _err.forEach((e) => console.error('   - ' + e));
  process.exit(1);
}

const STORE = process.env.SHOPIFY_STORE_URL;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';
const THEME_PATH =
  (process.argv.find((a) => a.startsWith('--theme-path=')) || '').split('=')[1] || 't/5';

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;

if (!STORE || !TOKEN) {
  console.error('❌ SHOPIFY_STORE_URL et SHOPIFY_ACCESS_TOKEN requis.');
  process.exit(1);
}

const BASE = `https://${STORE}/admin/api/${API_VERSION}`;
const HEADERS = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN };

/* Les `productId` sont ceux de la boutique de DÉVELOPPEMENT : sans valeur sur
   une autre boutique. Surchargeables par --product-id=<clé>=<id>. */
const PRODUCTS = {
  sweatshirt:       { productId: '9167767240867', prefix: TEXTILES.sweatshirt.prefix },
  tshirt:           { productId: '9167767404707', prefix: TEXTILES.tshirt.prefix },
  tshirt_polyester: { productId: '9167767732387', prefix: TEXTILES.tshirt_polyester.prefix },
};

for (const arg of process.argv.filter((a) => a.startsWith('--product-id='))) {
  const [cle, id] = arg.slice('--product-id='.length).split('=');
  if (!PRODUCTS[cle]) { console.error(`❌ --product-id : clé inconnue « ${cle} »`); process.exit(1); }
  if (!/^d+$/.test(id || '')) { console.error(`❌ --product-id=${cle}= : id numérique attendu`); process.exit(1); }
  PRODUCTS[cle].productId = id;
  console.log(`  ↪ ${cle} : productId forcé à ${id}`);
}

/* Correspondance libellé de variant -> fichier image : déléguée au module
   PARTAGÉ (couleurs-textiles.mjs).

   Ce fichier portait sa propre table `COLOR_SLUGS` avec les 15 anciennes
   couleurs FRANÇAISES. Le thème utilise désormais 40 libellés ANGLAIS : les 25
   nouvelles couleurs étaient rejetées en « couleur inconnue », et les 15 autres
   ne matchaient plus (le variant s'appelle « Black », pas « Noir »).

   `fichiersImage()` essaie le slug anglais PUIS le français, donc les images
   déjà livrées sous l'ancien nom sont retrouvées. */
const PAR_NOM = {};
for (const c of COULEURS) PAR_NOM[c.nom] = c;

async function shopify(path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function assetExists(filename) {
  const url = `https://${STORE}/cdn/shop/${THEME_PATH}/assets/${filename}`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok ? url : null;
  } catch { return null; }
}

async function processProduct(key) {
  const conf = PRODUCTS[key];
  console.log(`\n=== ${key} (product ${conf.productId}) ===`);
  const { product } = await shopify(`/products/${conf.productId}.json`);
  const imgById = {};
  for (const im of product.images) imgById[im.id] = im.src.split('/').pop().split('?')[0];

  for (const v of product.variants) {
    const couleur = PAR_NOM[v.option1];
    if (!couleur) { console.log(`  ⏭  ${v.option1}: couleur absente de couleurs-textiles.mjs`); continue; }

    /* Noms candidats, anglais d'abord : dès que le visuel définitif est livré
       sous ce nom, il remplace l'ancien sans modifier le code. */
    const candidats = fichiersImage(conf.prefix, couleur, 'face');
    const currentImg = v.image_id ? imgById[v.image_id] : '';

    // Déjà l'une des bonnes images -> on saute (idempotence).
    if (currentImg && candidats.includes(currentImg)) {
      console.log(`  ✓ ${v.option1}: déjà '${currentImg}'`);
      continue;
    }

    let url = null, filename = null;
    for (const nom of candidats) {
      url = await assetExists(nom);
      if (url) { filename = nom; break; }
    }
    if (!url) {
      console.log(`  ⚠️  ${v.option1}: aucune image trouvée (essayé : ${candidats.join(', ')})`);
      continue;
    }

    if (!APPLY) {
      console.log(`  [dry-run] ${v.option1}: ${currentImg || '(aucune)'} -> ${filename}`);
      continue;
    }

    try {
      const { image } = await shopify(`/products/${conf.productId}/images.json`, 'POST', {
        image: { src: url, variant_ids: [v.id] },
      });
      console.log(`  🖼  ${v.option1}: image ${image.id} (${filename}) liée au variant ${v.id}`);
    } catch (e) {
      console.log(`  ❌ ${v.option1}: échec -> ${e.message}`);
    }
  }
}

(async () => {
  console.log(`Store: ${STORE} | mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}${ONLY ? ` | only=${ONLY}` : ''}`);
  const keys = ONLY ? [ONLY] : Object.keys(PRODUCTS);
  for (const key of keys) {
    if (!PRODUCTS[key]) { console.log(`Clé inconnue: ${key}`); continue; }
    await processProduct(key);
  }
  console.log('\nFini.');
})().catch((e) => { console.error('\n💥', e.message); process.exit(1); });
