/**
 * Crée les 4 variants COULEUR du produit « Drapeau personnalisé ».
 *
 * Pourquoi ce script existe
 * -------------------------
 * Le produit n'avait qu'un variant `Default Title` alors que le configurateur
 * propose 4 couleurs (nuancier de conf-dynamic-layout.js:568) : Blanc, Noir,
 * Rouge, Bleu. Les commandes ne portaient donc pas la couleur choisie côté
 * Shopify — elle n'existait que dans les propriétés de ligne du panier.
 *
 * Les libellés reprennent EXACTEMENT ceux du nuancier (`title="…"`) : c'est sur
 * eux que `variantForItem()` fait sa correspondance (recapitulatif.liquid:528).
 * Un « Bleu marine » côté Shopify contre un « Bleu » côté thème et le variant
 * ne serait jamais trouvé — le drapeau partirait au variant de base.
 *
 * Contrainte Shopify : `productVariantsBulkCreate` refuse de coexister avec le
 * variant par défaut. On passe donc `strategy: REMOVE_STANDALONE_VARIANT`, qui
 * le supprime dans la même opération — sinon l'API renvoie une erreur sur
 * l'option `Title` déjà occupée par « Default Title ».
 *
 * Usage (depuis customizer-backend/) :
 *   node --env-file=.env scripts/creer-variants-drapeaux.mjs            # à blanc
 *   node --env-file=.env scripts/creer-variants-drapeaux.mjs --ecrire
 */
const ECRIRE = process.argv.includes('--ecrire');
const STORE = process.env.SHOPIFY_STORE_URL;
const V = process.env.SHOPIFY_API_VERSION || '2026-07';
const CDN = 'https://massacre-officiel.com/cdn/shop/t/18/assets';

const PRODUIT = 'gid://shopify/Product/15982850572622';   // drapeau-personnalise

/* Libellé = celui du nuancier du thème. `image` = visuel recto paysage de la
   couleur, déjà déployé sur le CDN de t/18. */
const COULEURS = [
  { nom: 'Blanc', image: 'flag-0an-blanc-recto-paysage.png' },
  { nom: 'Noir', image: 'flag-0an-noir-recto-paysage.png' },
  { nom: 'Rouge', image: 'flag-0an-rouge-recto-paysage.png' },
  { nom: 'Bleu', image: 'flag-0an-bleu-marine-recto-paysage.png' },
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

async function graphql(query, variables) {
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

async function etat() {
  const d = await graphql(
    `query($id: ID!) {
       product(id: $id) {
         handle title
         options { name optionValues { name } }
         variants(first: 50) { edges { node { id title price } } }
       }
     }`,
    { id: PRODUIT },
  );
  return d.product;
}

async function principal() {
  if (!STORE || !process.env.SHOPIFY_CLIENT_ID) {
    console.error('SHOPIFY_STORE_URL et SHOPIFY_CLIENT_ID/SECRET requis.');
    process.exit(1);
  }
  console.log(`Boutique : ${STORE}\n`);

  const avant = await etat();
  console.log('=== AVANT ===');
  console.log(`  ${avant.handle} — ${avant.title}`);
  console.log(`  options  : ${avant.options.map((o) => o.name).join(', ')}`);
  console.log(`  variants : ${avant.variants.edges.length}`);
  for (const e of avant.variants.edges) {
    console.log(`    ${e.node.id.split('/').pop().padEnd(16)}${(e.node.title || '-').padEnd(16)}${e.node.price}`);
  }

  const prix = avant.variants.edges[0]?.node.price || '19.90';

  if (avant.variants.edges.length > 1) {
    console.log('\nLe produit a déjà plusieurs variants — rien à faire.');
    return;
  }

  console.log(`\n=== ${ECRIRE ? 'CRÉATION' : 'MARCHE À BLANC'} ===`);
  console.log(`  option « Couleur » avec ${COULEURS.length} valeurs, à ${prix} € :`);
  for (const c of COULEURS) console.log(`    ${c.nom.padEnd(8)} ${c.image}`);

  if (!ECRIRE) {
    console.log('\n  Relancer avec --ecrire pour appliquer.');
    return;
  }

  /* 1) Créer l'option « Couleur ».
     `productVariantsBulkCreate` échoue avec « Option does not exist » si on lui
     passe un `optionName` inconnu du produit — l'option doit préexister. Le
     produit n'a pour l'instant que l'option implicite `Title`.

     `variants: []` : on ne laisse PAS cette mutation générer les variants. Elle
     les créerait sans prix ni image, qu'il faudrait ensuite corriger un par un ;
     REMOVE_STANDALONE_VARIANT à l'étape suivante s'en charge proprement. */
  const opt = await graphql(
    `mutation($productId: ID!, $options: [OptionCreateInput!]!) {
       productOptionsCreate(productId: $productId, options: $options, variantStrategy: LEAVE_AS_IS) {
         userErrors { field message }
       }
     }`,
    {
      productId: PRODUIT,
      options: [
        {
          name: 'Couleur',
          values: COULEURS.map((c) => ({ name: c.nom })),
        },
      ],
    },
  );
  const errsOpt = opt.productOptionsCreate?.userErrors || [];
  if (errsOpt.length) {
    console.error("\nÉCHEC création de l'option :");
    for (const e of errsOpt) console.error(`  ${(e.field || []).join('.')} ${e.message}`);
    process.exit(1);
  }
  console.log('  option « Couleur » créée');

  /* 2) Les images sont fournies par `mediaSrc` à la création : Shopify les
     télécharge et les rattache au variant dans la même opération. */
  const d = await graphql(
    `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
       productVariantsBulkCreate(
         productId: $productId,
         variants: $variants,
         strategy: REMOVE_STANDALONE_VARIANT
       ) {
         productVariants { id title price }
         userErrors { field message }
       }
     }`,
    {
      productId: PRODUIT,
      variants: COULEURS.map((c) => ({
        optionValues: [{ name: c.nom, optionName: 'Couleur' }],
        price: prix,
        mediaSrc: [`${CDN}/${c.image}`],
      })),
    },
  );

  const errs = d.productVariantsBulkCreate?.userErrors || [];
  if (errs.length) {
    console.error('\nÉCHEC :');
    for (const e of errs) console.error(`  ${(e.field || []).join('.')} ${e.message}`);
    process.exit(1);
  }

  const apres = await etat();
  console.log('\n=== APRÈS ===');
  console.log(`  options  : ${apres.options.map((o) => `${o.name} (${o.optionValues.map((v) => v.name).join(', ')})`).join(' | ')}`);
  console.log(`  variants : ${apres.variants.edges.length}`);
  for (const e of apres.variants.edges) {
    console.log(`    ${e.node.id.split('/').pop().padEnd(16)}${(e.node.title || '-').padEnd(16)}${e.node.price}`);
  }
  console.log('\n  À REPORTER dans le thème (CONF_COLOR_VARIANTS.drapeaux) :');
  for (const e of apres.variants.edges) {
    console.log(`    '${e.node.title}': ${e.node.id.split('/').pop()},`);
  }
}

principal().catch((e) => {
  console.error('Erreur :', e.message);
  process.exit(1);
});
