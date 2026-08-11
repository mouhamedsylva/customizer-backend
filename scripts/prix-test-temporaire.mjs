/**
 * Fixe TEMPORAIREMENT le prix d'un produit du configurateur, pour tester un vrai
 * paiement à faible coût — puis le restaure.
 *
 * Pourquoi ce script existe
 * -------------------------
 * Valider la chaîne complète (checkout Shopify → webhook → dashboard → fiche de
 * production) demande un paiement RÉEL : le mode test de Shopify désactiverait
 * les paiements de la boutique, qui est en activité (1799 commandes).
 *
 * Passer par un script plutôt que par l'admin Shopify : les 40 variants couleur
 * doivent changer ENSEMBLE, et le prix d'origine est enregistré dans un fichier
 * pour que la restauration ne dépende pas de la mémoire de l'opérateur.
 *
 * ATTENTION — le prix est PUBLIC pendant l'opération. Un client qui passe sur la
 * fiche produit pendant le test paiera ce prix. À faire vite, et à restaurer
 * immédiatement après.
 *
 * Usage (depuis customizer-backend/) :
 *   node --env-file=.env scripts/prix-test-temporaire.mjs                       # etat
 *   node --env-file=.env scripts/prix-test-temporaire.mjs 1.00 --ecrire         # baisse a 1 EUR
 *   node --env-file=.env scripts/prix-test-temporaire.mjs --restaurer --ecrire  # remet l'ancien prix
 */
import fs from 'node:fs';
import path from 'node:path';

const STORE = process.env.SHOPIFY_STORE_URL;
const V = process.env.SHOPIFY_API_VERSION || '2026-07';

/** Produit visé. Le t-shirt polyester : le moins cher des textiles à 1 unité. */
const HANDLE = 'textile-t-shirt-polyester';

/** Sauvegarde du prix d'origine, pour une restauration fiable. */
const SAUVEGARDE = path.join('inventaires', 'prix-avant-test.json');

const ECRIRE = process.argv.includes('--ecrire');
const RESTAURER = process.argv.includes('--restaurer');
const nouveauPrix = process.argv.find((a) => /^\d+(\.\d+)?$/.test(a));

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

async function lire() {
  const d = await gql(
    `query ($handle: String!) {
       productByIdentifier(identifier: { handle: $handle }) {
         id handle title
         variants(first: 100) { edges { node { id title price } } }
       }
     }`,
    { handle: HANDLE },
  );
  return d.productByIdentifier;
}

/** Applique un prix UNIQUE à tous les variants, par lots de 50 (limite Shopify). */
async function appliquer(productId, variants, prix) {
  const LOT = 50;
  let faits = 0;
  for (let i = 0; i < variants.length; i += LOT) {
    const tranche = variants.slice(i, i + LOT);
    const d = await gql(
      `mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
         productVariantsBulkUpdate(productId: $productId, variants: $variants) {
           productVariants { id }
           userErrors { field message }
         }
       }`,
      {
        productId,
        variants: tranche.map((v) => ({ id: v.id, price: prix })),
      },
    );
    const errs = d.productVariantsBulkUpdate?.userErrors || [];
    if (errs.length) {
      throw new Error(errs.map((e) => e.message).join(' | '));
    }
    faits += d.productVariantsBulkUpdate?.productVariants?.length || 0;
  }
  return faits;
}

async function principal() {
  if (!STORE || !process.env.SHOPIFY_CLIENT_ID) {
    console.error('SHOPIFY_STORE_URL et SHOPIFY_CLIENT_ID/SECRET requis.');
    process.exit(1);
  }
  console.log(`Boutique : ${STORE}\n`);

  const p = await lire();
  if (!p) {
    console.error(`Produit « ${HANDLE} » introuvable.`);
    process.exit(1);
  }
  const variants = p.variants.edges.map((e) => e.node);
  const prixActuels = [...new Set(variants.map((v) => v.price))];

  console.log(`=== ${p.handle} — ${p.title} ===`);
  console.log(`   variants : ${variants.length}`);
  console.log(`   prix     : ${prixActuels.join(', ')} EUR`);
  console.log('');

  /* ── Restauration ─────────────────────────────────────────────────────── */
  if (RESTAURER) {
    if (!fs.existsSync(SAUVEGARDE)) {
      console.error(`Sauvegarde absente (${SAUVEGARDE}) : prix d'origine inconnu.`);
      console.error("Relancer d'abord la baisse, ou remettre le prix à la main.");
      process.exit(1);
    }
    const sav = JSON.parse(fs.readFileSync(SAUVEGARDE, 'utf8'));
    console.log(`=== RESTAURATION vers ${sav.prix} EUR ===`);
    if (!ECRIRE) {
      console.log('   (marche à blanc — relancer avec --ecrire)');
      return;
    }
    const n = await appliquer(p.id, variants, sav.prix);
    console.log(`   ${n} variant(s) remis à ${sav.prix} EUR`);
    const apres = await lire();
    console.log(
      `   verification : ${[...new Set(apres.variants.edges.map((e) => e.node.price))].join(', ')} EUR`,
    );
    return;
  }

  /* ── Baisse ───────────────────────────────────────────────────────────── */
  if (!nouveauPrix) {
    console.log('Aucun prix fourni : lecture seule.');
    console.log(`Pour baisser : node --env-file=.env scripts/prix-test-temporaire.mjs 1.00 --ecrire`);
    return;
  }

  console.log(`=== BAISSE vers ${nouveauPrix} EUR ===`);
  console.log('   ATTENTION : ce prix est PUBLIC. Un client de passage le paierait.');
  console.log('');

  if (!ECRIRE) {
    console.log(`   ${variants.length} variant(s) passeraient de ${prixActuels.join('/')} à ${nouveauPrix} EUR`);
    console.log('   (marche à blanc — relancer avec --ecrire)');
    return;
  }

  /* Sauvegarde AVANT d'écrire : si la mutation échoue à mi-parcours, le prix
     d'origine reste connu. Un seul prix par produit ici (vérifié : les 40
     variants sont au même tarif) — on refuse d'écraser une sauvegarde
     existante, qui porterait le vrai prix d'origine. */
  if (prixActuels.length > 1) {
    console.error(`Les variants n'ont pas tous le même prix (${prixActuels.join(', ')}).`);
    console.error('Restauration impossible à garantir — opération annulée.');
    process.exit(1);
  }
  if (!fs.existsSync(SAUVEGARDE)) {
    fs.mkdirSync(path.dirname(SAUVEGARDE), { recursive: true });
    fs.writeFileSync(
      SAUVEGARDE,
      JSON.stringify({ handle: HANDLE, prix: prixActuels[0], date: '2026-08-11' }, null, 1),
    );
    console.log(`   prix d'origine sauvegardé (${prixActuels[0]} EUR) -> ${SAUVEGARDE}`);
  } else {
    console.log(`   sauvegarde déjà présente, conservée : ${SAUVEGARDE}`);
  }

  const n = await appliquer(p.id, variants, nouveauPrix);
  console.log(`   ${n} variant(s) passés à ${nouveauPrix} EUR`);

  const apres = await lire();
  console.log(
    `   verification : ${[...new Set(apres.variants.edges.map((e) => e.node.price))].join(', ')} EUR`,
  );
  console.log('');
  console.log('   APRÈS LE TEST, restaurer :');
  console.log('     node --env-file=.env scripts/prix-test-temporaire.mjs --restaurer --ecrire');
}

principal().catch((e) => {
  console.error('Erreur :', e.message);
  process.exit(1);
});
