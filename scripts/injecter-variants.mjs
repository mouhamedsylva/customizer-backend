/**
 * Injecte les IDs de variants de `inventaires/variants.json` dans le thème.
 *
 *   node scripts/injecter-variants.mjs --theme=../Configurateur-travail          # aperçu
 *   node scripts/injecter-variants.mjs --theme=../Configurateur-travail --apply  # écrit
 *
 * Aucun accès réseau : purement local, sur les fichiers du thème.
 *
 * Ce qu'il remplace
 * -----------------
 *   sections/recapitulatif.liquid   CONF_VARIANTS (5 clés) + CONF_COLOR_VARIANTS
 *   assets/conf-main-inline.js      CONF_VARIANTS + CONF_SLEEVE_VARIANT
 *
 * Pourquoi un script et pas une édition à la main
 * -----------------------------------------------
 * 126 identifiants à reporter. Un chiffre faux et l'article correspondant est
 * silencieusement écarté au checkout (`variantForItem()` renvoie `undefined`) —
 * sans message d'erreur, ni pour le client ni pour le commerçant.
 *
 * Invariant préservé
 * ------------------
 * `CONF_VARIANTS` n'a **PAS** de clé `patches`. C'est ce qui déclenche la bascule
 * devis pour les coins (voir le commentaire de recapitulatif.liquid:305). Le
 * script vérifie cette absence après écriture et échoue si elle disparaît.
 */
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const THEME = (process.argv.find((a) => a.startsWith('--theme=')) || '').split('=')[1];

if (!THEME) {
  console.error('❌ --theme=<chemin> requis');
  console.error('   Exemple : node scripts/injecter-variants.mjs --theme=../Configurateur-travail');
  process.exit(1);
}

const RACINE = path.resolve(import.meta.dirname, '..', THEME);
const RECAP = path.join(RACINE, 'sections', 'recapitulatif.liquid');
const MAIN = path.join(RACINE, 'assets', 'conf-main-inline.js');
const SRC = path.join(import.meta.dirname, '..', 'inventaires', 'variants.json');

for (const [f, quoi] of [[SRC, 'export des variants'], [RECAP, 'récapitulatif'], [MAIN, 'script principal']]) {
  if (!fs.existsSync(f)) {
    console.error(`❌ ${quoi} introuvable : ${f}`);
    if (f === SRC) console.error('   Lancez d\'abord : node scripts/exporter-variants.mjs');
    process.exit(1);
  }
}

const V = JSON.parse(fs.readFileSync(SRC, 'utf8'));

/* Garde-fou sur la source : mieux vaut refuser que d'écrire des IDs partiels. */
const attendus = ['sweatshirt', 'tshirt', 'tshirt_polyester', 'drapeaux', 'coins'];
const manquants = attendus.filter((k) => !V.CONF_VARIANTS[k]);
if (manquants.length) {
  console.error(`❌ variants.json incomplet : ${manquants.join(', ')} absent(s)`);
  process.exit(1);
}
if ('patches' in V.CONF_VARIANTS) {
  console.error('❌ variants.json contient une clé `patches` : les coins deviendraient');
  console.error('   payables en ligne alors qu\'ils sont sur devis. Refus.');
  process.exit(1);
}
if (!V.CONF_SLEEVE_VARIANT) {
  console.error('❌ CONF_SLEEVE_VARIANT absent de variants.json');
  process.exit(1);
}

console.log(`Thème    : ${RACINE}`);
console.log(`Source   : inventaires/variants.json (${V.boutique}, ${V.date})`);
console.log(`Mode     : ${APPLY ? '⚠️  APPLY (écriture)' : 'APERÇU'}\n`);

const modifs = [];

/**
 * Remplace un bloc délimité par des accolades équilibrées.
 * @param {string} src     contenu du fichier
 * @param {RegExp} debut   motif de la ligne d'ouverture
 * @param {string} neuf    bloc de remplacement
 */
function remplacerBloc(src, debut, neuf) {
  const L = src.split('\n');
  const i = L.findIndex((l) => debut.test(l));
  if (i === -1) return null;
  /* Compter les accolades pour trouver la fin : un `indexOf('};')` naïf
     s'arrêterait au premier sous-objet fermé. */
  let prof = 0, fin = -1;
  for (let j = i; j < L.length; j++) {
    prof += (L[j].match(/\{/g) || []).length - (L[j].match(/\}/g) || []).length;
    if (prof === 0 && j > i) { fin = j; break; }
  }
  if (fin === -1) return null;
  return {
    resultat: [...L.slice(0, i), ...neuf.split('\n'), ...L.slice(fin + 1)].join('\n'),
    lignesRemplacees: fin - i + 1,
  };
}

/* ── 1. CONF_VARIANTS du récapitulatif (indentation 2 espaces) ─────────── */

const blocVariants = (ind) => {
  const l = [];
  l.push(`${ind}var CONF_VARIANTS = {`);
  const large = Math.max(...attendus.map((k) => k.length)) + 1;
  attendus.forEach((k, n) => {
    const virgule = n < attendus.length - 1 ? ',' : '';
    const note = k === 'coins' ? '   // « Patch personnalisé » (patchs codés)' : '';
    l.push(`${ind}  ${(k + ':').padEnd(large + 1)}${V.CONF_VARIANTS[k]}${virgule}${note}`);
  });
  l.push(`${ind}  // patches (= COINS réels) : pas de variant, sur devis uniquement.`);
  l.push(`${ind}  // C'est cette ABSENCE qui déclenche la bascule devis — ne pas ajouter`);
  l.push(`${ind}  // de clé ici sans retirer d'abord la bascule.`);
  l.push(`${ind}};`);
  return l.join('\n');
};

/* ── 2. CONF_COLOR_VARIANTS (les 120 IDs) ───────────────────────────────── */

const blocCouleurs = (ind) => {
  const l = [];
  l.push(`${ind}var CONF_COLOR_VARIANTS = {`);
  const prods = Object.keys(V.CONF_COLOR_VARIANTS);
  prods.forEach((p, ip) => {
    l.push(`${ind}  ${p}: {`);
    const couleurs = Object.entries(V.CONF_COLOR_VARIANTS[p]);
    const large = Math.max(...couleurs.map(([c]) => c.length)) + 4;
    couleurs.forEach(([c, id], ic) => {
      const virgule = ic < couleurs.length - 1 ? ',' : '';
      l.push(`${ind}    ${(`'${c}':`).padEnd(large)}${id}${virgule}`);
    });
    l.push(`${ind}  }${ip < prods.length - 1 ? ',' : ''}`);
  });
  l.push(`${ind}};`);
  return l.join('\n');
};

/* ── Application ────────────────────────────────────────────────────────── */

let recap = fs.readFileSync(RECAP, 'utf8');

const r1 = remplacerBloc(recap, /^\s*var CONF_VARIANTS\s*=\s*\{/, blocVariants('  '));
if (!r1) { console.error('❌ CONF_VARIANTS introuvable dans le récapitulatif'); process.exit(1); }
recap = r1.resultat;
modifs.push(`recapitulatif.liquid  CONF_VARIANTS       ${r1.lignesRemplacees} lignes → 5 clés`);

const r2 = remplacerBloc(recap, /^\s*var CONF_COLOR_VARIANTS\s*=\s*\{/, blocCouleurs('  '));
if (!r2) { console.error('❌ CONF_COLOR_VARIANTS introuvable'); process.exit(1); }
recap = r2.resultat;
const nbCouleurs = Object.values(V.CONF_COLOR_VARIANTS)
  .reduce((s, o) => s + Object.keys(o).length, 0);
modifs.push(`recapitulatif.liquid  CONF_COLOR_VARIANTS ${r2.lignesRemplacees} lignes → ${nbCouleurs} IDs`);

let main = fs.readFileSync(MAIN, 'utf8');

const r3 = remplacerBloc(main, /^\s*window\.CONF_VARIANTS\s*=\s*\{/,
  blocVariants('    ').replace('var CONF_VARIANTS', 'window.CONF_VARIANTS'));
if (!r3) { console.error('❌ window.CONF_VARIANTS introuvable dans conf-main-inline.js'); process.exit(1); }
main = r3.resultat;
modifs.push(`conf-main-inline.js   CONF_VARIANTS       ${r3.lignesRemplacees} lignes → 5 clés`);

const avantSleeve = main;
main = main.replace(/window\.CONF_SLEEVE_VARIANT\s*=\s*\d+;/,
  `window.CONF_SLEEVE_VARIANT = ${V.CONF_SLEEVE_VARIANT};`);
if (main === avantSleeve) { console.error('❌ CONF_SLEEVE_VARIANT introuvable'); process.exit(1); }
modifs.push(`conf-main-inline.js   CONF_SLEEVE_VARIANT → ${V.CONF_SLEEVE_VARIANT}`);

modifs.forEach((m) => console.log('  ' + m));

/* ── Vérification AVANT écriture ─────────────────────────────────────────── */

const erreurs = [];
/**
 * Extrait un bloc `X = { … };` en comptant les accolades.
 *
 * Une regex `[\s\S]*?\n\s{2,4}\};` échouait : elle impose l'indentation exacte de
 * la ligne de fermeture, qui diffère entre le Liquid (2 espaces) et le JS
 * (4 espaces), et casse au moindre réalignement. Compter les accolades est
 * insensible à la mise en forme.
 */
function extraireBloc(contenu, motif) {
  const L = contenu.split('\n');
  const i = L.findIndex((l) => motif.test(l));
  if (i === -1) return null;
  let prof = 0;
  for (let j = i; j < L.length; j++) {
    prof += (L[j].match(/\{/g) || []).length - (L[j].match(/\}/g) || []).length;
    if (prof === 0 && j > i) return L.slice(i, j + 1).join('\n');
  }
  return null;
}

for (const [nom, contenu, motif] of [
  ['recapitulatif.liquid', recap, /^\s*var CONF_VARIANTS\s*=\s*\{/],
  ['conf-main-inline.js', main, /^\s*window\.CONF_VARIANTS\s*=\s*\{/],
]) {
  /* L'invariant qui compte : pas de clé `patches` dans CONF_VARIANTS. On ne
     regarde que le bloc, pas le fichier — les commentaires en parlent. */
  const brut = extraireBloc(contenu, motif);
  if (!brut) { erreurs.push(`${nom} : bloc CONF_VARIANTS illisible après écriture`); continue; }
  const bloc = brut.replace(/\/\/.*$/gm, '');
  if (/\bpatches\s*:/.test(bloc)) erreurs.push(`${nom} : clé \`patches\` réapparue`);
  const cles = [...bloc.matchAll(/^\s*([a-z_]+):\s*\d+/gm)].map((x) => x[1]);
  if (cles.length !== 5) erreurs.push(`${nom} : ${cles.length} clés au lieu de 5 (${cles.join(', ')})`);
}
/* Le nombre d'IDs couleur doit être exact. */
const mc = extraireBloc(recap, /^\s*var CONF_COLOR_VARIANTS\s*=\s*\{/);
if (mc) {
  const n = (mc.match(/:\s*\d+/g) || []).length;
  if (n !== nbCouleurs) erreurs.push(`CONF_COLOR_VARIANTS : ${n} IDs au lieu de ${nbCouleurs}`);
} else erreurs.push('CONF_COLOR_VARIANTS illisible après écriture');

if (erreurs.length) {
  console.error('\n❌ vérification échouée — RIEN n\'a été écrit :');
  erreurs.forEach((e) => console.error('   - ' + e));
  process.exit(1);
}
console.log('\n  vérifications : 5 clés, pas de `patches`, ' + nbCouleurs + ' IDs couleur — ok');

if (!APPLY) {
  console.log('\nAperçu seulement. Relancez avec --apply pour écrire.');
  process.exit(0);
}

/* Sauvegarde avant écriture : un retour arrière doit rester possible. */
const suffixe = '.avant-injection';
fs.copyFileSync(RECAP, RECAP + suffixe);
fs.copyFileSync(MAIN, MAIN + suffixe);
fs.writeFileSync(RECAP, recap, 'utf8');
fs.writeFileSync(MAIN, main, 'utf8');

console.log('\n✅ écrit. Sauvegardes : *' + suffixe);
console.log('   Vérifiez, puis supprimez-les avant le `theme push`.');
