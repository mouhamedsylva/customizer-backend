/**
 * Désactive le SUIVI DE STOCK des variants du configurateur.
 *
 * Pourquoi ce script existe
 * -------------------------
 * `productVariantsBulkCreate` active le suivi de stock par défaut
 * (`inventoryItem.tracked = true`). Combiné à une quantité de 0 et à la
 * politique `deny`, Shopify REFUSE la vente : mesuré, `/cart/add.js` renvoyait
 * 422 sur les 4 variants couleur du drapeau, alors que les 6 autres produits
 * du configurateur passaient en 200.
 *
 * Un produit personnalisé est fabriqué à la commande : il n'a pas de stock à
 * décompter. Les 6 produits créés par `setup-boutique.mjs` sont d'ailleurs tous
 * en `tracked = false` — ce script aligne simplement les drapeaux dessus.
 *
 * Le champ REST `inventory_management` ne suffit PAS : un PUT sur
 * `/variants/:id.json` est accepté (200) mais ignoré. Le suivi appartient à
 * l'`inventoryItem`, accessible seulement en GraphQL.
 *
 * Usage (depuis customizer-backend/) :
 *   node --env-file=.env scripts/desactiver-suivi-stock.mjs            # à blanc
 *   node --env-file=.env scripts/desactiver-suivi-stock.mjs --ecrire
 */
const ECRIRE = process.argv.includes('--ecrire');
const STORE = process.env.SHOPIFY_STORE_URL;
const V = process.env.SHOPIFY_API_VERSION || '2026-07';

/** Les 7 produits du configurateur, par handle. */
const HANDLES = [
  'textile-sweatshirt',
  'textile-t-shirt-coton',
  'textile-t-shirt-polyester',
  'drapeau-personnalise',
  'patch-personnalise',
  'coin-metal-personnalise',
  'personnalisation-manche',
];

let jeton = null;
async function token() {
  if (jeton) return jeton;
  const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  if (!r.ok) throw new Error(`OAuth ${r.status} : ${(await r.text()).slice(0, 200)}`);
  jeton = (await r.json()).access_token;
  return jeton;
}

async function gql(query, variables) {
  const t = await token();
  const r = await fetch(`https://${STORE}/admin/api/${V}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': t, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

const Q_PRODUIT = `
  query ($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      handle
      variants(first: 100) {
        edges { node { id title inventoryItem { id tracked } } }
      }
    }
  }`;

const M_UNTRACK = `
  mutation ($id: ID!) {
    inventoryItemUpdate(id: $id, input: { tracked: false }) {
      inventoryItem { tracked }
      userErrors { field message }
    }
  }`;

async function principal() {
  if (!STORE || !process.env.SHOPIFY_CLIENT_ID) {
    console.error('SHOPIFY_STORE_URL et SHOPIFY_CLIENT_ID/SECRET requis.');
    process.exit(1);
  }
  console.log(`Boutique : ${STORE}`);
  console.log(ECRIRE ? '\nMODE ÉCRITURE\n' : '\nMARCHE À BLANC\n');

  let total = 0;
  let corriges = 0;

  for (const handle of HANDLES) {
    const d = await gql(Q_PRODUIT, { handle });
    const p = d.productByIdentifier;
    if (!p) {
      console.log(`  ${handle.padEnd(28)} INTROUVABLE`);
      continue;
    }
    const variants = p.variants.edges.map((e) => e.node);
    const suivis = variants.filter((v) => v.inventoryItem?.tracked);
    total += variants.length;

    if (!suivis.length) {
      console.log(`  ${handle.padEnd(28)} ${variants.length} variant(s), aucun suivi — rien à faire`);
      continue;
    }
    console.log(`  ${handle.padEnd(28)} ${suivis.length}/${variants.length} variant(s) avec suivi de stock`);

    if (!ECRIRE) continue;

    for (const v of suivis) {
      const u = await gql(M_UNTRACK, { id: v.inventoryItem.id });
      const errs = u.inventoryItemUpdate?.userErrors || [];
      if (errs.length) {
        console.log(`      ECHEC ${v.title} : ${errs.map((e) => e.message).join(' | ')}`);
      } else {
        corriges++;
        console.log(`      OK    ${v.title} -> tracked=${u.inventoryItemUpdate.inventoryItem.tracked}`);
      }
    }
  }

  console.log('');
  console.log(`  ${total} variant(s) examiné(s)${ECRIRE ? `, ${corriges} corrigé(s)` : ''}`);
  if (!ECRIRE) console.log('  Relancer avec --ecrire pour appliquer.');
}

principal().catch((e) => {
  console.error('Erreur :', e.message);
  process.exit(1);
});
