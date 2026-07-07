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

const PRODUCTS = {
  sweatshirt:       { productId: '9167767240867', prefix: 'sweatshirt' },
  tshirt:           { productId: '9167767404707', prefix: 'tshirt' },
  tshirt_polyester: { productId: '9167767732387', prefix: 'tshirt-polyester' },
};

// libellé variant (option1) -> slug de fichier
const COLOR_SLUGS = {
  'Noir': 'noir',
  'Blanc cassé': 'blanc-casse',
  'Gris': 'gris',
  'Gris foncé': 'gris-fonce',
  'Gris ardoise': 'gris-ardoise',
  'Bleu marine': 'bleu-marine',
  'Bleu ciel': 'bleu-ciel',
  'Vert foncé': 'vert-fonce',
  'Rose clair': 'rose-clair',
  'Rose': 'rose',
  'Rouge': 'rouge',
  'Orange': 'orange',
  'Jaune': 'jaune',
  'Violet': 'violet',
  'Marron': 'marron',
};

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
    const slug = COLOR_SLUGS[v.option1];
    if (!slug) { console.log(`  ⏭  ${v.option1}: couleur inconnue`); continue; }

    const filename = `${conf.prefix}-${slug}-face.png`;
    const currentImg = v.image_id ? imgById[v.image_id] : '';

    // Déjà la bonne image (le nom contient le slug couleur) -> on saute.
    if (currentImg && currentImg.includes(`-${slug}-face`)) {
      console.log(`  ✓ ${v.option1}: déjà '${currentImg}'`);
      continue;
    }

    const url = await assetExists(filename);
    if (!url) { console.log(`  ⚠️  ${v.option1}: image ${filename} introuvable sur le CDN`); continue; }

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
