/**
 * Crée les 7 produits du configurateur sur une boutique Shopify.
 *
 *   # aperçu — n'écrit RIEN (défaut)
 *   SHOPIFY_STORE_URL=38cca3.myshopify.com node scripts/setup-boutique.mjs
 *
 *   # application réelle
 *   SHOPIFY_STORE_URL=38cca3.myshopify.com node scripts/setup-boutique.mjs --apply
 *
 * Prérequis : `shopify store auth --store <boutique> --scopes write_products,read_products`
 * (le script passe par le CLI, voir pont-cli.mjs — aucun token à fournir).
 *
 * Ce qu'il crée
 * -------------
 *   3 textiles          option « Couleur », 40 variants chacun
 *   3 produits simples  drapeau, patch, coin métal (un variant)
 *   1 add-on            « Personnalisation manche », masqué du storefront
 *
 * Ce qu'il ne fait JAMAIS
 * -----------------------
 * - Aucun `DELETE`, sur aucune ressource.
 * - Aucune modification d'un produit existant : si le `handle` est déjà pris, le
 *   produit est SIGNALÉ et IGNORÉ. C'est le garde-fou principal — la boutique
 *   cible est en production (396 produits, 4361 variants au 2026-08-07), et une
 *   écriture sur un produit du client détruirait ses variants et les images qui
 *   leur sont associées.
 * - Aucune publication : les produits sont créés en `DRAFT`. C'est au commerçant
 *   de les activer quand il a vérifié prix, descriptions et images.
 *
 * Idempotent : relançable sans créer de doublons.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execute, produitParHandle, boutique } from './pont-cli.mjs';
import { COULEURS, TEXTILES, SIMPLES, verifier } from './couleurs-textiles.mjs';

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;

/* Garde-fou : un module de couleurs incohérent produirait un catalogue
   incohérent, et le constater après 120 variants créés coûte cher. */
const errs = verifier();
if (errs.length) {
  console.error('❌ couleurs-textiles.mjs incohérent :');
  errs.forEach((e) => console.error('   - ' + e));
  process.exit(1);
}

const STORE = boutique();
if (!STORE) {
  console.error('❌ SHOPIFY_STORE_URL non défini.');
  console.error('   Exemple : SHOPIFY_STORE_URL=38cca3.myshopify.com node scripts/setup-boutique.mjs');
  process.exit(1);
}

/** Le « Coin métal » est à 0,00 € : vendu sur devis uniquement (voir SIMPLES). */
const PRODUITS = [
  ...Object.entries(TEXTILES).map(([cle, p]) => ({ cle, ...p, type: 'textile' })),
  ...Object.entries(SIMPLES).map(([cle, p]) => ({ cle, ...p, type: 'simple' })),
  {
    cle: 'manche',
    handle: 'personnalisation-manche',
    titre: 'Personnalisation manche',
    prix: '4.00',
    type: 'addon',
  },
];

/** Échappe une chaîne pour l'insérer dans une requête GraphQL. */
const q = (s) => JSON.stringify(String(s));

const cree = [];
const ignores = [];
const echecs = [];

/**
 * Crée un produit s'il n'existe pas déjà.
 * @param {object} p une entrée de PRODUITS
 */
async function traiter(p) {
  console.log(`\n=== ${p.cle} — ${p.titre} ===`);

  /* 1) Le handle est-il libre ? Recherche sur TOUS les statuts, brouillons et
        archivés compris : un produit archivé occupe son handle. */
  const existant = await produitParHandle(p.handle);
  if (existant) {
    console.log(`  ⚠️  handle « ${p.handle} » DÉJÀ PRIS`);
    console.log(`      → "${existant.title}" [${existant.status}] `
      + `${existant.variantsCount.count} variants, ${existant.media.nodes.length} médias`);
    console.log('      → IGNORÉ. Aucune modification : ce produit appartient au client.');
    ignores.push({ ...p, existant: existant.id, titreExistant: existant.title });
    return;
  }
  console.log(`  handle « ${p.handle} » libre`);

  const nbVariants = p.type === 'textile' ? COULEURS.length : 1;
  console.log(`  prix ${p.prix} EUR · ${nbVariants} variant(s)`
    + (p.type === 'textile' ? ' (option Couleur)' : ''));

  if (!APPLY) {
    console.log('  [aperçu] serait créé — utilisez --apply pour écrire');
    cree.push({ ...p, simule: true });
    return;
  }

  /* 2) Création. `status: DRAFT` volontairement : rien n'apparaît en boutique
        avant validation humaine.

        `productOptions` porte les 40 valeurs de couleur ; Shopify génère un
        variant par valeur. Pour les produits simples, aucune option : Shopify
        crée le variant « Default Title ». */
  const options = p.type === 'textile'
    ? `productOptions: [{ name: "Couleur", values: [${COULEURS.map((c) => `{ name: ${q(c.nom)} }`).join(', ')}] }]`
    : '';

  let creation;
  try {
    creation = await execute(`mutation {
      productCreate(product: {
        title: ${q(p.titre)}
        handle: ${q(p.handle)}
        status: DRAFT
        vendor: "Custom Textile"
        productType: ${q(p.type === 'textile' ? 'Textile personnalisé' : 'Produit personnalisé')}
        ${options}
      }) {
        product { id handle title status variants(first: 100) { nodes { id title } } }
        userErrors { field message }
      }
    }`, { mutation: true });
  } catch (e) {
    console.log(`  ❌ échec de création : ${e.message.slice(0, 200)}`);
    echecs.push({ ...p, erreur: e.message.slice(0, 200) });
    return;
  }

  const r = creation.productCreate;
  if (r.userErrors && r.userErrors.length) {
    console.log('  ❌ refus de Shopify :');
    r.userErrors.forEach((u) => console.log(`      ${(u.field || []).join('.')} : ${u.message}`));
    echecs.push({ ...p, erreur: JSON.stringify(r.userErrors) });
    return;
  }

  const prod = r.product;
  console.log(`  ✅ créé : ${prod.id}  (${prod.variants.nodes.length} variant(s) initial)`);

  /* 2 bis) Générer les variants de couleur.

     `productCreate` avec `productOptions` crée bien l'option « Couleur » et ses
     40 valeurs, mais **un seul variant** — celui de la première valeur. Mesuré :
     40 optionValues, 1 variant. Les 39 autres doivent être créés explicitement.

     `productVariantsBulkCreate` avec `strategy: REMOVE_STANDALONE_VARIANT`
     remplace ce variant initial par la série complète, au lieu de laisser un
     doublon sur la première couleur. */
  let ids = prod.variants.nodes.map((v) => v.id);

  if (p.type === 'textile') {
    const aCreer = COULEURS.map((c) => `{
      optionValues: [{ optionName: "Couleur", name: ${q(c.nom)} }]
      price: ${q(p.prix)}
      inventoryPolicy: CONTINUE
      inventoryItem: { tracked: false }
    }`).join(', ');

    try {
      const bulk = await execute(`mutation {
        productVariantsBulkCreate(
          productId: ${q(prod.id)}
          strategy: REMOVE_STANDALONE_VARIANT
          variants: [${aCreer}]
        ) {
          productVariants { id title price }
          userErrors { field message }
        }
      }`, { mutation: true });

      const bue = bulk.productVariantsBulkCreate.userErrors || [];
      if (bue.length) {
        console.log('  ⚠️  création des variants partielle :');
        bue.slice(0, 4).forEach((u) => console.log(`      ${(u.field || []).join('.')} : ${u.message}`));
      }
      const nouveaux = bulk.productVariantsBulkCreate.productVariants || [];
      if (nouveaux.length) {
        ids = nouveaux.map((v) => v.id);
        console.log(`  ✅ ${nouveaux.length} variants de couleur créés`);
      }
    } catch (e) {
      console.log(`  ❌ variants non créés : ${e.message.slice(0, 200)}`);
      console.log('      Le produit existe avec 1 seul variant — à compléter.');
      echecs.push({ ...p, erreur: 'variants : ' + e.message.slice(0, 150) });
    }
  }

  /* 3) Prix et suivi de stock sur les variants qui n'auraient pas été couverts
        par la création en lot (cas des produits simples, dont le variant
        « Default Title » est créé au prix 0 avec le suivi ACTIF — il serait donc
        « épuisé » et invendable).

        `inventoryPolicy: CONTINUE` + `tracked: false` : toujours vendable. */
  const maj = ids.map((id) => `{ id: ${q(id)}, price: ${q(p.prix)}, `
    + `inventoryPolicy: CONTINUE, inventoryItem: { tracked: false } }`).join(', ');

  try {
    const mv = await execute(`mutation {
      productVariantsBulkUpdate(productId: ${q(prod.id)}, variants: [${maj}]) {
        productVariants { id price }
        userErrors { field message }
      }
    }`, { mutation: true });
    const ue = mv.productVariantsBulkUpdate.userErrors || [];
    if (ue.length) {
      console.log('  ⚠️  prix/stock partiellement appliqués :');
      ue.slice(0, 3).forEach((u) => console.log(`      ${u.message}`));
    } else {
      console.log(`  ✅ ${ids.length} variant(s) à ${p.prix} EUR, stock non suivi`);
    }
  } catch (e) {
    console.log(`  ⚠️  prix non appliqué : ${e.message.slice(0, 160)}`);
    console.log('      Le produit EXISTE mais ses variants sont à 0 EUR — à corriger.');
  }

  cree.push({ ...p, id: prod.id, variants: ids.length });
}

/* ────────────────────────────────────────────────────────────────────── */

console.log(`Boutique : ${STORE}`);
console.log(`Mode     : ${APPLY ? '⚠️  APPLY (écriture réelle)' : 'APERÇU (aucune écriture)'}`);
if (ONLY) console.log(`Filtre   : ${ONLY}`);
console.log(`Produits : ${PRODUITS.length} (${COULEURS.length} couleurs pour les textiles)`);

const liste = ONLY ? PRODUITS.filter((p) => p.cle === ONLY) : PRODUITS;
if (!liste.length) {
  console.error(`\n❌ --only=${ONLY} : clé inconnue.`);
  console.error(`   Attendu : ${PRODUITS.map((p) => p.cle).join(', ')}`);
  process.exit(1);
}

for (const p of liste) await traiter(p);

/* ── Bilan ─────────────────────────────────────────────────────────────── */

console.log('\n' + '─'.repeat(64));
console.log(`créés   : ${cree.length}${APPLY ? '' : ' (simulés)'}`);
console.log(`ignorés : ${ignores.length}${ignores.length ? ' (handle déjà pris — produits du client préservés)' : ''}`);
console.log(`échecs  : ${echecs.length}`);

if (ignores.length) {
  console.log('\nIgnorés :');
  ignores.forEach((i) => console.log(`  ${i.handle} → "${i.titreExistant}"`));
}
if (echecs.length) {
  console.log('\nÉchecs :');
  echecs.forEach((e) => console.log(`  ${e.handle} : ${e.erreur}`));
}

/* Les IDs de variants à reporter dans le thème. Sans ce bloc, il faudrait
   recopier 43 identifiants à la main — la principale source d'erreur. */
if (APPLY && cree.length) {
  const rapport = { date: new Date().toISOString().slice(0, 10), boutique: STORE, cree, ignores, echecs };
  const dossier = path.join(import.meta.dirname, '..', 'inventaires');
  fs.mkdirSync(dossier, { recursive: true });
  const f = path.join(dossier, 'produits-crees.json');
  fs.writeFileSync(f, JSON.stringify(rapport, null, 2), 'utf8');
  console.log(`\nRapport écrit : inventaires/produits-crees.json`);
  console.log('\nÉtape suivante : récupérer les IDs de variants pour le thème');
  console.log('  node scripts/exporter-variants.mjs');
}

if (!APPLY) console.log('\nAucune écriture. Relancez avec --apply pour créer.');
process.exit(echecs.length ? 1 : 0);
