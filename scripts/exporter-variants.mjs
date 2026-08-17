/**
 * Exporte les IDs de variants des 7 produits du configurateur, prêts à coller
 * dans le thème.
 *
 *   SHOPIFY_STORE_URL=38cca3.myshopify.com node scripts/exporter-variants.mjs
 *
 * Lecture seule : aucune écriture, aucune mutation.
 *
 * Pourquoi ce script existe
 * -------------------------
 * Le thème référence 46 identifiants de variants en dur (1 par produit + 45
 * couleurs). Les recopier à la main depuis l'admin est la principale source
 * d'erreur : un chiffre faux, et l'article correspondant est silencieusement
 * écarté au checkout (`variantForItem()` renvoie `undefined`).
 *
 * Deux points de vigilance dans la sortie
 * ---------------------------------------
 * 1. `CONF_VARIANTS` n'a **PAS** de clé `patches`. C'est délibéré : les coins se
 *    vendent uniquement sur devis, et c'est l'absence de variant qui déclenche la
 *    bascule devis (voir sections/recapitulatif.liquid:314). Le produit
 *    « Coin métal personnalisé » existe quand même, à 0,00 €, comme référence
 *    pour le dashboard admin.
 *
 * 2. Le nommage interne est INVERSÉ, et c'est voulu :
 *      productType 'coins'   → produit « Patch personnalisé »
 *      productType 'patches' → produit « Coin métal personnalisé »
 */
import fs from 'node:fs';
import path from 'node:path';
import { execute, boutique } from './pont-cli.mjs';
import { TEXTILES, SIMPLES } from './couleurs-textiles.mjs';

const q = (s) => JSON.stringify(String(s));

/** Extrait l'ID numérique d'un GID Shopify (`gid://shopify/ProductVariant/123`). */
const num = (gid) => String(gid).split('/').pop();

const STORE = boutique();
if (!STORE) {
  console.error('❌ SHOPIFY_STORE_URL non défini.');
  process.exit(1);
}

/** Les produits à interroger : clé interne → handle. */
const CIBLES = [
  ...Object.entries(TEXTILES).map(([cle, p]) => ({ cle, handle: p.handle, textile: true })),
  ...Object.entries(SIMPLES).map(([cle, p]) => ({ cle, handle: p.handle, textile: false })),
  { cle: 'manche', handle: 'personnalisation-manche', textile: false },
  /* Le supplément manches est réparti sur DEUX produits : le plan Basic limite
     un produit à 100 variants, et 3 textiles × 40 couleurs en font 120. Le
     polyester a donc son propre produit (voir create-sleeve-polyester-product.mjs). */
  { cle: 'manchePoly', handle: 'personnalisation-manche-polyester', textile: false },
];

console.log(`Boutique : ${STORE}\n`);

const resultats = {};
for (const c of CIBLES) {
  const d = await execute(`query {
    productByIdentifier(identifier: { handle: ${q(c.handle)} }) {
      id title status
      variants(first: 100) { nodes { id title selectedOptions { name value } } }
    }
  }`);
  const p = d.productByIdentifier;
  if (!p) {
    console.log(`  ⚠️  ${c.handle} : ABSENT — lancez d'abord setup-boutique.mjs --apply`);
    continue;
  }
  resultats[c.cle] = { ...c, produit: p };
  console.log(`  ${c.handle.padEnd(30)} ${p.status.padEnd(7)} ${p.variants.nodes.length} variant(s)`);
}

console.log('\n' + '═'.repeat(70));
console.log('À COLLER DANS LE THÈME');
console.log('═'.repeat(70));

/* ── CONF_VARIANTS ───────────────────────────────────────────────────────
   Le variant de BASE de chaque produit. Pour un textile c'est le premier
   (la couleur exacte est portée par CONF_COLOR_VARIANTS). */
console.log('\n// sections/recapitulatif.liquid  (~ligne 314)');
console.log('// assets/conf-main-inline.js       (~ligne 599)');
console.log('\n  var CONF_VARIANTS = {');
const ordre = ['sweatshirt', 'tshirt', 'tshirt_polyester', 'drapeaux', 'coins'];
for (const cle of ordre) {
  const r = resultats[cle];
  if (!r) { console.log(`    // ${cle} : produit absent`); continue; }
  const v = r.produit.variants.nodes[0];
  const commentaire = cle === 'coins' ? '   // « Patch personnalisé » (patchs codés)' : '';
  console.log(`    ${(cle + ':').padEnd(19)}${num(v.id)},${commentaire}`);
}
console.log('    // patches (= COINS réels) : PAS de variant, sur devis uniquement.');
console.log('  };');

/* ── CONF_SLEEVE_VARIANT ─────────────────────────────────────────────── */
const m = resultats.manche;
if (m) {
  console.log('\n// assets/conf-main-inline.js (juste après CONF_VARIANTS)');
  console.log(`    window.CONF_SLEEVE_VARIANT = ${num(m.produit.variants.nodes[0].id)};`);
}

/* ── CONF_SLEEVE_COLOR_VARIANTS ──────────────────────────────────────────
   Variant du supplément manches PAR TEXTILE ET COULEUR : c'est ce qui fait que
   la vignette du checkout montre la manche à la bonne teinte, au lieu d'un
   visuel unique pour toutes les commandes.

   Les clés produit sont celles de `it.productType` côté thème (sweatshirt,
   tshirt, tshirt_polyester), pour que sleeveVariantForItem() les retrouve sans
   traduction. Le polyester vient d'un AUTRE produit Shopify — d'où la lecture
   de deux résultats distincts. */
const mp = resultats.manchePoly;
if (m || mp) {
  console.log(String.fromCharCode(10) + '// sections/recapitulatif.liquid (a cote de CONF_SLEEVE_VARIANT)');
  console.log('  window.CONF_SLEEVE_COLOR_VARIANTS = {');

  /* Produit principal : option1 = titre du textile, option2 = couleur. */
  const parTextile = { 'Textile - Sweatshirt': 'sweatshirt', 'Textile - T-shirt Coton': 'tshirt' };
  for (const [titre, cle] of Object.entries(parTextile)) {
    const noeuds = (m ? m.produit.variants.nodes : [])
      .filter((v) => (v.selectedOptions || [])[0] && v.selectedOptions[0].value === titre);
    if (!noeuds.length) continue;
    console.log(`    '${cle}': {`);
    noeuds.forEach((v) => {
      const couleur = v.selectedOptions[1] ? v.selectedOptions[1].value : '';
      if (couleur) console.log(`      '${couleur}': ${num(v.id)},`);
    });
    console.log('    },');
  }

  /* Polyester : produit séparé, une seule option (la couleur). */
  if (mp) {
    console.log("    'tshirt_polyester': {");
    mp.produit.variants.nodes.forEach((v) => {
      const couleur = (v.selectedOptions || [])[0] ? v.selectedOptions[0].value : '';
      if (couleur) console.log(`      '${couleur}': ${num(v.id)},`);
    });
    console.log('    },');
  }
  console.log('  };');
}

/* ── CONF_COLOR_VARIANTS ─────────────────────────────────────────────────
   Un ID par couleur et par textile : c'est ce qui fait que la vignette du
   checkout montre la bonne couleur. */
console.log('\n// sections/recapitulatif.liquid  (~ligne 326)');
console.log('\n  var CONF_COLOR_VARIANTS = {');
for (const cle of ['sweatshirt', 'tshirt', 'tshirt_polyester']) {
  const r = resultats[cle];
  if (!r) { console.log(`    // ${cle} : produit absent`); continue; }
  console.log(`    ${cle}: {`);
  for (const v of r.produit.variants.nodes) {
    /* `selectedOptions` est plus fiable que `title` : celui-ci peut concaténer
       plusieurs options si le produit en gagne une un jour. */
    const couleur = (v.selectedOptions.find((o) => o.name === 'Couleur') || {}).value || v.title;
    console.log(`      ${(q(couleur) + ':').padEnd(22)}${num(v.id)},`);
  }
  console.log('    },');
}
console.log('  };');

/* ── Sauvegarde machine ─────────────────────────────────────────────────── */
const dossier = path.join(import.meta.dirname, '..', 'inventaires');
fs.mkdirSync(dossier, { recursive: true });
const sortie = {
  date: new Date().toISOString().slice(0, 10),
  boutique: STORE,
  CONF_VARIANTS: Object.fromEntries(ordre
    .filter((c) => resultats[c])
    .map((c) => [c, Number(num(resultats[c].produit.variants.nodes[0].id))])),
  CONF_SLEEVE_VARIANT: m ? Number(num(m.produit.variants.nodes[0].id)) : null,
  CONF_COLOR_VARIANTS: Object.fromEntries(['sweatshirt', 'tshirt', 'tshirt_polyester']
    .filter((c) => resultats[c])
    .map((c) => [c, Object.fromEntries(resultats[c].produit.variants.nodes.map((v) => [
      (v.selectedOptions.find((o) => o.name === 'Couleur') || {}).value || v.title,
      Number(num(v.id)),
    ]))])),
  produits: Object.fromEntries(Object.entries(resultats)
    .map(([k, r]) => [k, { id: num(r.produit.id), handle: r.handle, statut: r.produit.status }])),
};
const f = path.join(dossier, 'variants.json');
fs.writeFileSync(f, JSON.stringify(sortie, null, 2), 'utf8');
console.log(`\nSauvegardé : inventaires/variants.json`);
