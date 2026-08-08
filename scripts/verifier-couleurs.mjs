/**
 * Vérifie que `couleurs-textiles.mjs` reste synchronisé avec le thème.
 *
 *   node scripts/verifier-couleurs.mjs
 *
 * À lancer après toute modification de la palette, d'un côté comme de l'autre.
 * Aucun accès réseau, aucune écriture : purement local.
 *
 * Pourquoi ce script existe
 * -------------------------
 * Les deux listes avaient déjà divergé en silence : le thème était passé aux 40
 * couleurs anglaises tandis que le backend restait sur 15 couleurs françaises.
 * Rien ne le signalait, et le symptôme n'aurait apparu qu'au checkout — une
 * couleur commandée sans variant correspondant.
 *
 * L'invariant à tenir : le `nom` d'une couleur est la CLÉ de jointure entre le
 * thème (`selColor(this, hex, nom)`) et Shopify (`variant.option1`). S'ils
 * divergent d'un caractère, la jointure casse.
 */
import fs from 'fs';
import path from 'path';
import { COULEURS, TEXTILES, SIMPLES, fichiersImage, verifier } from './couleurs-textiles.mjs';

const FRONT = path.join(import.meta.dirname, '..', '..', 'customizer_frontend');
const lire = (p) => fs.readFileSync(path.join(FRONT, p), 'utf8');

let ko = 0;
const check = (cond, label, detail) => {
  if (cond) { console.log('  ok   ' + label); }
  else { ko++; console.log('  KO   ' + label + (detail ? ' — ' + detail : '')); }
};

console.log('\ncouleurs-textiles.mjs — synchronisation avec le thème\n');

/* 1. Cohérence interne du module. */
const err = verifier();
check(err.length === 0, 'le module est cohérent avec lui-même', err.join(' | '));

/* 2. Le document de référence. */
let doc = [];
try {
  const md = lire('COULEURS-TEXTILES.md');
  doc = [...md.matchAll(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`/gm)]
    .map((m) => ({ nom: m[1].trim(), slug: m[2], hex: m[3].toLowerCase() }));
} catch (e) {
  check(false, 'COULEURS-TEXTILES.md lisible', e.message);
}
check(doc.length === COULEURS.length,
  `même nombre de couleurs que le document (${COULEURS.length})`, `document : ${doc.length}`);

const parSlug = {};
COULEURS.forEach((c) => { parSlug[c.slug] = c; });
const nomsDivergents = doc.filter((d) => !parSlug[d.slug] || parSlug[d.slug].nom !== d.nom);
check(nomsDivergents.length === 0, 'noms identiques au document',
  nomsDivergents.map((d) => d.slug).join(', '));
const hexDivergents = doc.filter((d) => parSlug[d.slug]
  && parSlug[d.slug].hex.toLowerCase() !== d.hex);
check(hexDivergents.length === 0, 'hex identiques au document',
  hexDivergents.map((d) => `${d.slug} (doc ${d.hex})`).join(', '));

/* 3. Les pastilles du thème — la jointure qui compte vraiment.
      `option1` du variant Shopify sera EXACTEMENT ce `nom`. */
const sec = lire('sections/configurateur.liquid');
const pastilles = [...sec.matchAll(/selColor\(this,\s*'([^']+)',\s*'([^']+)'\)/g)]
  .map((m) => ({ hex: m[1].toLowerCase(), nom: m[2] }));
check(pastilles.length === COULEURS.length,
  `${COULEURS.length} pastilles dans le thème`, `trouvé : ${pastilles.length}`);

const nomsModule = new Set(COULEURS.map((c) => c.nom));
const orphelines = pastilles.filter((p) => !nomsModule.has(p.nom));
check(orphelines.length === 0,
  'chaque pastille du thème a son entrée dans le module',
  orphelines.map((p) => `« ${p.nom} »`).join(', ')
  + (orphelines.length ? ' → ces couleurs n\'auront AUCUN variant au checkout' : ''));

const nomsPastilles = new Set(pastilles.map((p) => p.nom));
const sansPastille = COULEURS.filter((c) => !nomsPastilles.has(c.nom));
check(sansPastille.length === 0,
  'chaque entrée du module a sa pastille',
  sansPastille.map((c) => `« ${c.nom} »`).join(', ')
  + (sansPastille.length ? ' → variants créés pour rien' : ''));

/* 4. `tx_colors` : la liste Liquid qui génère PRODUCT_IMAGE_URLS. */
const layout = lire('layout/configurateur.liquid');
const mtx = layout.match(/assign tx_colors = "([^"]+)"/);
if (mtx) {
  const tx = mtx[1].split(',').map((s) => s.trim()).filter(Boolean);
  const manquants = COULEURS.filter((c) => !tx.includes(c.slug));
  check(manquants.length === 0, `tx_colors couvre les ${COULEURS.length} slugs`,
    manquants.map((c) => c.slug).join(', '));
} else {
  check(false, 'tx_colors trouvé dans le layout');
}

/* 5. Images : constat chiffré, PAS une assertion dure.
      Une couleur sans image retombe sur le générique — dégradé, pas cassé.
      L'assertion porte sur le générique, dont l'absence casserait vraiment. */
console.log('');
let vraies = 0;
for (const p of Object.values(TEXTILES)) {
  for (const c of COULEURS) {
    if (fichiersImage(p.prefix, c, 'face')
      .some((n) => fs.existsSync(path.join(FRONT, 'assets', n)))) vraies++;
  }
}
const total = Object.keys(TEXTILES).length * COULEURS.length;
console.log(`  info : ${vraies}/${total} variants ont une vraie image couleur, `
  + `${total - vraies} sur le générique`);

const sansGenerique = Object.values(TEXTILES)
  .filter((p) => !fs.existsSync(path.join(FRONT, 'assets', `${p.prefix}-face.png`)));
check(sansGenerique.length === 0,
  'chaque textile a son image générique de repli',
  sansGenerique.map((p) => `${p.prefix}-face.png`).join(', ')
  + (sansGenerique.length ? ' → les couleurs sans visuel n\'auraient AUCUNE image' : ''));

/* 6. Les handles doivent être uniques : deux produits sur le même handle, et le
      script en écraserait un. */
const handles = [...Object.values(TEXTILES), ...Object.values(SIMPLES)].map((p) => p.handle);
const dbl = handles.filter((h, i) => handles.indexOf(h) !== i);
check(dbl.length === 0, `${handles.length} handles produit distincts`, dbl.join(', '));

console.log('\n' + (ko === 0 ? 'SYNCHRONISÉ' : ko + ' ÉCART(S)') + '\n');
process.exit(ko === 0 ? 0 : 1);
