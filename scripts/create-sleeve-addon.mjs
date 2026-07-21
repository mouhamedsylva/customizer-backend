/**
 * Crée le produit add-on « Personnalisation manche » sur Shopify.
 *
 * Pourquoi un produit dédié : le textile est ajouté au panier NATIF
 * (/cart/add.js) avec un variant à prix fixe. Or une line item property ne
 * porte aucun prix, et modifier un prix au panier exige les Cart Transform
 * Functions (Shopify Plus). Le supplément doit donc être une VRAIE ligne de
 * panier — c'est le pattern « add-on product » standard.
 *
 * Le produit est masqué du storefront (statut actif mais hors de tout canal
 * de vente visible + metafield seo.hidden) : achetable par ID de variant,
 * introuvable en navigation ou en recherche.
 *
 * Utilisation (depuis customizer-backend/) :
 *   # aperçu sans rien créer (par défaut) :
 *   node scripts/create-sleeve-addon.mjs
 *   # créer réellement :
 *   node scripts/create-sleeve-addon.mjs --apply
 *   # prix personnalisé (défaut 4.00) :
 *   node scripts/create-sleeve-addon.mjs --apply --price=6.50
 *
 * Variables d'env requises (mêmes que le backend) :
 *   SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN, SHOPIFY_API_VERSION (optionnel)
 *
 * En sortie : l'ID de variant à reporter dans configurateur.liquid
 * (window.CONF_SLEEVE_VARIANT).
 */

const STORE = process.env.SHOPIFY_STORE_URL;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';

const APPLY = process.argv.includes('--apply');
const PRICE =
  (process.argv.find((a) => a.startsWith('--price=')) || '').split('=')[1] || '4.00';

if (!STORE || !TOKEN) {
  console.error('❌ SHOPIFY_STORE_URL et SHOPIFY_ACCESS_TOKEN doivent être définis.');
  process.exit(1);
}

const BASE = `https://${STORE}/admin/api/${API_VERSION}`;
const HEADERS = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN };

const HANDLE = 'personnalisation-manche';

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${path} -> ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

/** Le produit existe-t-il déjà ? (idempotence) */
async function findExisting() {
  const { products } = await api(`/products.json?handle=${HANDLE}&limit=1`);
  return (products && products[0]) || null;
}

const existing = await findExisting();

if (existing) {
  const v = existing.variants[0];
  console.log('✅ Le produit add-on existe déjà — rien à créer.');
  console.log(`   produit  : ${existing.title} (id ${existing.id})`);
  console.log(`   variant  : ${v.id}  —  ${v.price} €`);
  console.log('');
  console.log('   À reporter dans sections/configurateur.liquid :');
  console.log(`   window.CONF_SLEEVE_VARIANT = ${v.id};`);
  process.exit(0);
}

console.log('📦 Produit add-on à créer');
console.log(`   titre  : Personnalisation manche`);
console.log(`   handle : ${HANDLE}`);
console.log(`   prix   : ${PRICE} €`);
console.log(`   visible: non (masqué du storefront)`);
console.log('');

if (!APPLY) {
  console.log('🔍 DRY-RUN — rien n\'a été créé.');
  console.log('   Relance avec --apply pour créer le produit.');
  process.exit(0);
}

const payload = {
  product: {
    title: 'Personnalisation manche',
    handle: HANDLE,
    body_html:
      'Supplément appliqué pour la personnalisation d\'une manche. ' +
      'Ligne ajoutée automatiquement par le configurateur.',
    vendor: 'Custom Textile',
    product_type: 'Option',
    status: 'active',
    // Pas de canal de vente publié : le produit reste achetable par ID de
    // variant, mais n'apparaît ni en navigation ni en recherche.
    published: false,
    tags: 'addon,option,manche,hidden',
    variants: [
      {
        price: PRICE,
        // Achetable sans stock : c'est une prestation, pas un article physique.
        inventory_management: null,
        inventory_policy: 'continue',
        requires_shipping: false,
        taxable: true,
        title: 'Default Title',
      },
    ],
  },
};

const { product } = await api('/products.json', {
  method: 'POST',
  body: JSON.stringify(payload),
});

const variant = product.variants[0];

// Marque le produit comme masqué pour les thèmes qui respectent seo.hidden.
try {
  await api(`/products/${product.id}/metafields.json`, {
    method: 'POST',
    body: JSON.stringify({
      metafield: { namespace: 'seo', key: 'hidden', value: '1', type: 'single_line_text_field' },
    }),
  });
  console.log('   metafield seo.hidden posé.');
} catch (e) {
  console.log(`   ⚠ metafield seo.hidden non posé (${e.message}) — sans conséquence.`);
}

console.log('');
console.log('✅ Produit add-on créé.');
console.log(`   produit : ${product.id}`);
console.log(`   variant : ${variant.id}  —  ${variant.price} €`);
console.log('');
console.log('   ÉTAPE SUIVANTE — reporter cet ID dans');
console.log('   customizer_frontend/sections/configurateur.liquid :');
console.log('');
console.log(`     window.CONF_SLEEVE_VARIANT = ${variant.id};`);
