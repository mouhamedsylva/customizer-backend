/**
 * Crée l'option "Couleur" + un variant par couleur sur les produits textiles,
 * et assigne à chaque variant l'image {produit}-{couleur}-face.png du thème.
 *
 * But : au checkout Shopify, la vignette de la ligne = image du variant commandé.
 * En ayant une image par couleur, la vignette prend la bonne couleur.
 *
 * Utilisation (depuis customizer-backend/) :
 *   # aperçu sans rien modifier (par défaut) :
 *   node scripts/create-color-variants.mjs
 *   # appliquer réellement, sur le sweatshirt uniquement :
 *   node scripts/create-color-variants.mjs --apply --only=sweatshirt
 *   # appliquer sur tous les produits textiles :
 *   node scripts/create-color-variants.mjs --apply
 *
 * Variables d'env requises (mêmes que le backend) :
 *   SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN, SHOPIFY_API_VERSION (optionnel)
 */

const STORE = process.env.SHOPIFY_STORE_URL;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;
// Préfixe CDN des assets du thème (le token n'a pas le scope read_themes, donc
// on construit l'URL publique directement). Déductible des URLs vues au checkout :
//   https://<store>/cdn/shop/t/5/assets/<fichier>.png
// Surchargeable via --theme-path=t/5
const THEME_PATH =
  (process.argv.find((a) => a.startsWith('--theme-path=')) || '').split('=')[1] || 't/5';

if (!STORE || !TOKEN) {
  console.error('❌ SHOPIFY_STORE_URL et SHOPIFY_ACCESS_TOKEN doivent être définis dans l\'environnement.');
  process.exit(1);
}

const BASE = `https://${STORE}/admin/api/${API_VERSION}`;
const HEADERS = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN };

// Produits textiles : clé -> { productId, prefixe de fichier image }
const PRODUCTS = {
  sweatshirt:       { productId: '9167767240867', prefix: 'sweatshirt' },
  tshirt:           { productId: '9167767404707', prefix: 'tshirt' },
  tshirt_polyester: { productId: '9167767732387', prefix: 'tshirt-polyester' },
};

// Couleurs : libellé affiché (option) -> slug de fichier
const COLORS = [
  ['Noir', 'noir'],
  ['Blanc cassé', 'blanc-casse'],
  ['Gris', 'gris'],
  ['Gris foncé', 'gris-fonce'],
  ['Gris ardoise', 'gris-ardoise'],
  ['Bleu marine', 'bleu-marine'],
  ['Bleu ciel', 'bleu-ciel'],
  ['Vert foncé', 'vert-fonce'],
  ['Rose clair', 'rose-clair'],
  ['Rose', 'rose'],
  ['Rouge', 'rouge'],
  ['Orange', 'orange'],
  ['Jaune', 'jaune'],
  ['Violet', 'violet'],
  ['Marron', 'marron'],
];

async function shopify(path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Shopify ${method} ${path} -> ${res.status}: ${text}`);
  }
  return data;
}

/** URL publique CDN d'un asset du thème, vérifiée par un HEAD (200 = présent). */
async function assetUrl(filename) {
  const url = `https://${STORE}/cdn/shop/${THEME_PATH}/assets/${filename}`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

async function processProduct(key) {
  const conf = PRODUCTS[key];
  console.log(`\n=== ${key} (product ${conf.productId}) ===`);

  const { product } = await shopify(`/products/${conf.productId}.json`);
  console.log(`  Titre: ${product.title}`);
  console.log(`  Options actuelles: ${JSON.stringify(product.options.map((o) => o.name))}`);
  console.log(`  Variants actuels: ${product.variants.length}`);

  // Sécurité : si l'option Couleur existe déjà, on ne recrée pas (évite les doublons).
  const hasColor = product.options.some((o) => o.name.toLowerCase() === 'couleur');
  if (hasColor) {
    console.log('  ⚠️  Option "Couleur" déjà présente -> produit ignoré (déjà traité).');
    return;
  }

  const basePrice = product.variants[0]?.price || '45.00';

  // Construit les nouveaux variants (un par couleur).
  // inventory_management=null + inventory_policy=continue : produit personnalisé
  // à la demande, toujours vendable (jamais "sold out").
  const variants = COLORS.map(([label]) => ({
    option1: label,
    price: basePrice,
    inventory_management: null,
    inventory_policy: 'continue',
  }));

  // Image générique du produit (repli si pas d'image par couleur).
  const genericUrl = await assetUrl(`${conf.prefix}-face.png`);

  // Récupère les URLs d'images couleur (face). À défaut d'image couleur,
  // on retombe sur l'image générique (la couleur reste indiquée en texte).
  const imagePlan = [];
  for (const [label, slug] of COLORS) {
    const filename = `${conf.prefix}-${slug}-face.png`;
    let url = await assetUrl(filename);
    let source = 'couleur';
    if (!url && genericUrl) { url = genericUrl; source = 'générique'; }
    imagePlan.push({ label, filename, url });
    console.log(`  image ${label.padEnd(14)} -> ${url ? source.toUpperCase() : 'AUCUNE'} (${url ? filename : ''})`);
  }

  if (!APPLY) {
    console.log('  [dry-run] 15 variants seraient créés + images assignées. (utilise --apply)');
    return;
  }

  // 1) Met à jour le produit : option Couleur + variants.
  console.log('  → Création de l\'option Couleur et des variants…');
  await shopify(`/products/${conf.productId}.json`, 'PUT', {
    product: {
      id: conf.productId,
      options: [{ name: 'Couleur', values: COLORS.map(([l]) => l) }],
      variants,
    },
  });

  // 2) Recharge le produit pour récupérer les nouveaux variant ids.
  const { product: updated } = await shopify(`/products/${conf.productId}.json`);
  const variantByLabel = {};
  for (const v of updated.variants) variantByLabel[v.option1] = v.id;

  // 3) Assigne les images. On crée une image par URL DISTINCTE (évite 15 doublons
  //    quand tous les variants partagent l'image générique), et on lie tous les
  //    variants correspondants à cette image en une fois.
  const byUrl = new Map();
  for (const plan of imagePlan) {
    const variantId = variantByLabel[plan.label];
    if (!plan.url || !variantId) {
      console.log(`  ⏭  ${plan.label}: ${!plan.url ? 'pas d\'URL' : 'variant introuvable'}`);
      continue;
    }
    if (!byUrl.has(plan.url)) byUrl.set(plan.url, { labels: [], variantIds: [] });
    const g = byUrl.get(plan.url);
    g.labels.push(plan.label);
    g.variantIds.push(variantId);
  }

  for (const [url, g] of byUrl) {
    try {
      const { image } = await shopify(`/products/${conf.productId}/images.json`, 'POST', {
        image: { src: url, variant_ids: g.variantIds },
      });
      console.log(`  🖼  image ${image.id} liée à ${g.variantIds.length} variant(s): ${g.labels.join(', ')}`);
    } catch (e) {
      console.log(`  ❌ échec image (${g.labels.join(', ')}) -> ${e.message}`);
    }
  }

  console.log(`  ✅ ${key} terminé.`);
}

(async () => {
  console.log(`Store: ${STORE} | API: ${API_VERSION} | mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}${ONLY ? ` | only=${ONLY}` : ''}`);
  console.log(`Assets thème: https://${STORE}/cdn/shop/${THEME_PATH}/assets/`);

  const keys = ONLY ? [ONLY] : Object.keys(PRODUCTS);
  for (const key of keys) {
    if (!PRODUCTS[key]) { console.log(`Clé produit inconnue: ${key}`); continue; }
    await processProduct(key);
  }
  console.log('\nFini.');
})().catch((e) => {
  console.error('\n💥 Erreur:', e.message);
  process.exit(1);
});
