/**
 * Active ou remet en brouillon les 7 produits du configurateur.
 *
 * Pourquoi ce script existe
 * -------------------------
 * `/cart/add.js` (panier Shopify natif, utilisé par goToCheckout du
 * récapitulatif) est une route du STOREFRONT : elle ne voit que les produits
 * publiés sur le canal « Boutique en ligne ». Mesuré le 10/08/2026 :
 *
 *   ACTIVE sans canal          -> 422 « Nous n'avons pas trouvé de variantes »
 *   ACTIVE + Boutique en ligne -> 200, ligne ajoutée au panier
 *
 * Un produit en brouillon ne peut donc PAS être commandé par ce chemin. Activer
 * est indispensable pour tester le parcours jusqu'au checkout — et l'opération
 * est réversible (vérifié : aller-retour complet sans trace résiduelle).
 *
 * Contrepartie assumée pendant la fenêtre d'activation : les produits sont
 * réellement publics. Mesuré, ils apparaissent alors dans /collections/all et
 * leur page /products/<handle> répond 200. D'où la restauration à faire dès les
 * tests terminés.
 *
 * Usage (depuis customizer-backend/) :
 *   SHOPIFY_STORE_URL=38cca3.myshopify.com node scripts/basculer-produits-conf.mjs etat
 *   SHOPIFY_STORE_URL=38cca3.myshopify.com node scripts/basculer-produits-conf.mjs activer --ecrire
 *   SHOPIFY_STORE_URL=38cca3.myshopify.com node scripts/basculer-produits-conf.mjs brouillon --ecrire
 *
 * Sans `--ecrire`, le script ne fait que LIRE et annoncer ce qu'il changerait.
 */
import { execute, boutique } from './pont-cli.mjs';

/** Canal « Boutique en ligne » de 38cca3 — le seul que le storefront consulte. */
const CANAL_BOUTIQUE = 'gid://shopify/Publication/191416369486';

/** Les 7 produits du configurateur portent ce fournisseur, et eux seuls. Filtrer
 *  par `vendor` évite de toucher aux 396 produits du client. */
const REQUETE = "vendor:'Custom Textile'";

const action = process.argv[2];
const ECRIRE = process.argv.includes('--ecrire');

if (!['etat', 'activer', 'brouillon'].includes(action)) {
  console.error('Usage : node scripts/basculer-produits-conf.mjs <etat|activer|brouillon> [--ecrire]');
  process.exit(1);
}

async function lireProduits() {
  const r = await execute(
    `query {
       products(first: 20, query: "${REQUETE}") {
         edges { node { id handle title status publishedAt } }
       }
     }`,
  );
  return (r?.products?.edges || []).map((e) => e.node);
}

function afficher(produits, titre) {
  console.log(`=== ${titre} ===`);
  for (const p of produits) {
    console.log(
      `  ${p.handle.padEnd(28)}${p.status.padEnd(7)} publie=${p.publishedAt ? 'OUI' : 'non'}`,
    );
  }
}

async function activer(produits) {
  for (const p of produits) {
    // 1) statut ACTIVE — nécessaire mais pas suffisant (mesuré : 422 sans canal).
    const a = await execute(
      `mutation { productUpdate(product: { id: "${p.id}", status: ACTIVE }) {
         product { handle status } userErrors { field message } } }`,
      { mutation: true },
    );
    const e1 = a?.productUpdate?.userErrors || [];
    if (e1.length) {
      console.log(`  ECHEC statut  ${p.handle} : ${JSON.stringify(e1)}`);
      continue;
    }

    // 2) publication sur le canal que /cart/add.js consulte.
    const b = await execute(
      `mutation { publishablePublish(id: "${p.id}",
         input: { publicationId: "${CANAL_BOUTIQUE}" }) {
         userErrors { field message } } }`,
      { mutation: true },
    );
    const e2 = b?.publishablePublish?.userErrors || [];
    console.log(
      e2.length
        ? `  ECHEC canal   ${p.handle} : ${JSON.stringify(e2)}`
        : `  active        ${p.handle}`,
    );
  }
}

async function remettreEnBrouillon(produits) {
  for (const p of produits) {
    // Ordre inverse de l'activation : retirer du canal AVANT de repasser en
    // DRAFT. L'inverse laisserait brièvement un produit DRAFT encore rattaché
    // au canal, état incohérent que Shopify accepte mais qui brouille l'audit.
    await execute(
      `mutation { publishableUnpublish(id: "${p.id}",
         input: { publicationId: "${CANAL_BOUTIQUE}" }) {
         userErrors { field message } } }`,
      { mutation: true },
    );
    const r = await execute(
      `mutation { productUpdate(product: { id: "${p.id}", status: DRAFT }) {
         product { handle status publishedAt } userErrors { field message } } }`,
      { mutation: true },
    );
    const e = r?.productUpdate?.userErrors || [];
    console.log(
      e.length
        ? `  ECHEC         ${p.handle} : ${JSON.stringify(e)}`
        : `  brouillon     ${p.handle}`,
    );
  }
}

async function principal() {
  console.log(`Boutique : ${boutique()}`);
  console.log('');

  const produits = await lireProduits();
  if (produits.length !== 7) {
    console.log(
      `ATTENTION : ${produits.length} produits trouvés au lieu de 7 — vérifier le filtre vendor.`,
    );
  }
  afficher(produits, 'ÉTAT ACTUEL');
  console.log('');

  if (action === 'etat') return;

  if (!ECRIRE) {
    console.log(
      `MARCHE À BLANC : « ${action} » toucherait ces ${produits.length} produits.`,
    );
    console.log('Relancer avec --ecrire pour appliquer.');
    return;
  }

  console.log(`=== ${action.toUpperCase()} ===`);
  if (action === 'activer') await activer(produits);
  else await remettreEnBrouillon(produits);

  console.log('');
  afficher(await lireProduits(), 'ÉTAT APRÈS');

  if (action === 'activer') {
    console.log('');
    console.log('Les produits sont PUBLICS : ils apparaissent dans /collections/all');
    console.log('et leur page produit répond 200. Repasser en brouillon dès les');
    console.log('tests terminés :');
    console.log('  node scripts/basculer-produits-conf.mjs brouillon --ecrire');
  }
}

principal().catch((e) => {
  console.error('Erreur :', e.message.slice(0, 300));
  process.exit(1);
});
