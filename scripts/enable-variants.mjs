/**
 * Rend les variants d'un produit toujours disponibles à la vente.
 * Les variants créés par create-color-variants sont "sold out" car Shopify
 * active le suivi de stock (inventory_management="shopify", quantité 0).
 * Pour du produit personnalisé à la demande, on désactive le suivi de stock
 * (inventory_management=null) -> le variant est toujours vendable.
 *
 * Utilisation (depuis customizer-backend/) :
 *   node --env-file=.env scripts/enable-variants.mjs                 # dry-run, tous les produits textiles
 *   node --env-file=.env scripts/enable-variants.mjs --apply --only=sweatshirt
 *   node --env-file=.env scripts/enable-variants.mjs --apply         # tous
 */

const STORE = process.env.SHOPIFY_STORE_URL;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;

if (!STORE || !TOKEN) {
  console.error('❌ SHOPIFY_STORE_URL et SHOPIFY_ACCESS_TOKEN requis.');
  process.exit(1);
}

const BASE = `https://${STORE}/admin/api/${API_VERSION}`;
const HEADERS = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN };

const PRODUCTS = {
  sweatshirt:       '9167767240867',
  tshirt:           '9167767404707',
  tshirt_polyester: '9167767732387',
};

async function shopify(path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function processProduct(key) {
  const productId = PRODUCTS[key];
  console.log(`\n=== ${key} (product ${productId}) ===`);
  const { product } = await shopify(`/products/${productId}.json`);
  console.log(`  ${product.variants.length} variants`);

  for (const v of product.variants) {
    const needs = v.inventory_management !== null || v.inventory_policy !== 'continue';
    if (!needs) { console.log(`  ✓ ${v.option1}: déjà vendable`); continue; }
    if (!APPLY) {
      console.log(`  [dry-run] ${v.option1}: inventory_management=${v.inventory_management} -> null`);
      continue;
    }
    await shopify(`/variants/${v.id}.json`, 'PUT', {
      variant: { id: v.id, inventory_management: null, inventory_policy: 'continue' },
    });
    console.log(`  ✅ ${v.option1}: rendu vendable (variant ${v.id})`);
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
