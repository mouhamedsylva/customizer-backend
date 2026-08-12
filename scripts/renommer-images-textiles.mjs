/**
 * Renomme les visuels textiles de `Customizer-images/` vers la convention du
 * thème, et les copie dans `Configurateur-travail/assets/`.
 *
 * Pourquoi ce script existe
 * -------------------------
 * Le thème cherche 360 fichiers `{produit}-{slug}-{vue}.png` — les 40 slugs
 * ANGLAIS sont déjà déclarés dans PRODUCT_IMAGE_URLS
 * (layout/configurateur.liquid:507). Il n'en trouvait que 9 : les visuels livrés
 * sont rangés par dossier de vue, avec le slug seul pour nom (`black.png`), sans
 * préfixe produit ni suffixe de vue. Chaque couleur retombait donc sur l'image
 * générique.
 *
 * Bonne nouvelle mesurée : les noms sont DÉJÀ en slug anglais. Il ne manque que
 * le préfixe et le suffixe — aucune traduction FR→EN n'est nécessaire, contrairement
 * à ce qu'annonçait COULEURS-NOMS.md (écrit avant l'inspection de ce dossier).
 *
 * Trois anomalies relevées dans la source, corrigées par la table CAS_PARTICULIERS
 * ci-dessous :
 *   1. `Sweatshirt/face` : 2 fichiers déjà nommés complets (apricot, ash).
 *   2. `Sweatshirt/dos`  : 4 noms accidentés — identifiés en OUVRANT les images et
 *      en les comparant aux vues de face correspondantes, pas par supposition.
 *   3. `t-shirt polyester` : pas de sous-dossiers de vue. Les 40 fichiers nommés
 *      sont des vues de FACE (vérifié visuellement) ; les 81
 *      `Code_Generated_Image*.png` sont ignorés — rien ne permet de savoir à
 *      quelle couleur ni à quelle vue ils correspondent.
 *
 * Usage (depuis customizer-backend/) :
 *   node scripts/renommer-images-textiles.mjs             # marche à blanc
 *   node scripts/renommer-images-textiles.mjs --ecrire
 */
import fs from 'node:fs';
import path from 'node:path';
import { COULEURS } from './couleurs-textiles.mjs';

const ECRIRE = process.argv.includes('--ecrire');

const SRC = path.join('..', 'Customizer-images');
const DEST = path.join('..', 'Configurateur-travail', 'assets');

/** Dossier source -> (préfixe produit, vue). */
const SOURCES = [
  { dir: 'Sweatshirt/face', prefixe: 'sweatshirt', vue: 'face' },
  { dir: 'Sweatshirt/dos', prefixe: 'sweatshirt', vue: 'dos' },
  { dir: 'Sweatshirt/coté', prefixe: 'sweatshirt', vue: 'cote' },
  { dir: 't-shirt coton/face', prefixe: 'tshirt', vue: 'face' },
  { dir: 't-shirt coton/dos', prefixe: 'tshirt', vue: 'dos' },
  { dir: 't-shirt coton/coté', prefixe: 'tshirt', vue: 'cote' },
  { dir: 't-shirt polyester/face', prefixe: 'tshirt-polyester', vue: 'face' },
  /* Vue CÔTÉ du polyester : fichiers `Code_Generated_Image (N).png`, sans
     couleur dans le nom. Résolue par le numéro — ordre alphabétique inversé,
     n° 41 = `white` (rang 40) … n° 80 = `apricot` (rang 1).

     Deux vérifications indépendantes concordent sur les 40 :
       - la règle arithmétique `n = 81 - rang` ;
       - l'appariement par COULEUR MESURÉE (scripts/apparier-polyester.mjs),
         distance RGB maximale de 11 — aucun cas douteux.
     C'est cette double concordance qui autorise le renommage automatique. */
  {
    dir: 't-shirt polyester/coté',
    prefixe: 'tshirt-polyester',
    vue: 'cote',
    baseNumero: 81, // slug = slugs[81 - n - 1]
  },
  /* Vue DOS du polyester : nommée à la main par le commerçant le 12/08/2026.
     Elle arrivait en `Code_Generated_Image (N).png` sur 41 fichiers — un sans
     numéro, ce qui décalait la série — et ni la règle arithmétique ni
     l'appariement par couleur ne la résolvaient : 9 divergences, dont l'image
     n° 37 noire là où les deux méthodes annonçaient une couleur vive. Le
     renommage automatique aurait produit des vignettes fausses au checkout.
     Les fichiers portant désormais leur slug, ce dossier se traite comme les
     autres. */
  { dir: 't-shirt polyester/dos', prefixe: 'tshirt-polyester', vue: 'dos' },
];

/**
 * Noms sources qui ne sont pas un slug reconnaissable.
 *
 * Les quatre entrées de `Sweatshirt/dos` viennent d'une saisie accidentée. Leur
 * couleur a été établie en OUVRANT chaque image et en la comparant à la vue de
 * face du même slug — `nn.png` est le bleu sombre de `navy.png`, `;,sa.png` le
 * bleu plus vif de `navy-blue`. Deviner d'après le nom aurait donné l'inverse.
 */
const CAS_PARTICULIERS = {
  'Sweatshirt/dos': {
    'nn.png': 'navy',
    ';,sa.png': 'navy-blue',
    'sk.png': 'sky',
    'blanc.png': 'white',
  },
  'Sweatshirt/face': {
    // Déjà au bon format : on les reconnaît pour ne pas les compter « inconnus ».
    'sweatshirt-apricot-face.png': 'apricot',
    'sweatshirt-ash-face.png': 'ash',
  },
};

const SLUGS = new Set(COULEURS.map((c) => c.slug));

/* Slugs triés alphabétiquement : c'est l'ordre dont les fichiers numérotés du
   polyester sont l'INVERSE. Trié explicitement plutôt que de se fier à l'ordre
   de déclaration de COULEURS — lequel n'a aucune raison de rester alphabétique
   si quelqu'un y insère une couleur. */
const SLUGS_TRIES = [...SLUGS].sort();

function principal() {
  if (!fs.existsSync(SRC)) {
    console.error(`Dossier source introuvable : ${path.resolve(SRC)}`);
    process.exit(1);
  }
  if (!fs.existsSync(DEST)) {
    console.error(`Dossier destination introuvable : ${path.resolve(DEST)}`);
    process.exit(1);
  }

  console.log(`Source      : ${path.resolve(SRC)}`);
  console.log(`Destination : ${path.resolve(DEST)}`);
  console.log(ECRIRE ? '\nMODE ÉCRITURE (copie)\n' : '\nMARCHE À BLANC\n');

  let total = 0;
  let ignores = 0;
  const manquants = [];

  for (const s of SOURCES) {
    const dossier = path.join(SRC, s.dir);
    if (!fs.existsSync(dossier)) {
      console.log(`  ${s.dir.padEnd(24)} DOSSIER ABSENT`);
      continue;
    }
    const particuliers = CAS_PARTICULIERS[s.dir] || {};
    const fichiers = fs.readdirSync(dossier).filter((f) => f.toLowerCase().endsWith('.png'));

    const vus = new Set();
    let copies = 0;
    let sautes = 0;

    for (const f of fichiers) {
      /* Slug : trois sources, par ordre de fiabilité décroissante.
         1. le NUMÉRO du fichier, quand le dossier suit un ordre vérifié ;
         2. la table des cas particuliers, établie en ouvrant les images ;
         3. le nom du fichier lui-même, déjà un slug anglais. */
      let slug;
      if (s.baseNumero) {
        const num = Number((f.match(/\((\d+)\)/) || [])[1] || 0);
        const rang = s.baseNumero - num;           // 1..40
        slug = num && rang >= 1 && rang <= SLUGS_TRIES.length
          ? SLUGS_TRIES[rang - 1]
          : null;
      } else {
        slug = particuliers[f] || f.replace(/\.png$/i, '');
      }
      if (!slug || !SLUGS.has(slug)) {
        sautes++;
        continue;
      }
      vus.add(slug);
      const cible = `${s.prefixe}-${slug}-${s.vue}.png`;
      if (ECRIRE) {
        fs.copyFileSync(path.join(dossier, f), path.join(DEST, cible));
      }
      copies++;
    }

    total += copies;
    ignores += sautes;

    const absents = [...SLUGS].filter((x) => !vus.has(x));
    if (absents.length) manquants.push({ dir: s.dir, absents });

    console.log(
      `  ${s.dir.padEnd(24)} ${String(copies).padStart(2)}/40 -> ${s.prefixe}-{slug}-${s.vue}.png` +
        (sautes ? `   (${sautes} ignoré${sautes > 1 ? 's' : ''})` : ''),
    );
  }

  console.log('');
  console.log(`  ${total} fichier(s) ${ECRIRE ? 'copiés' : 'à copier'}, ${ignores} ignoré(s)`);

  if (manquants.length) {
    console.log('');
    console.log('  COULEURS SANS VISUEL :');
    for (const m of manquants) {
      console.log(`    ${m.dir.padEnd(24)} ${m.absents.join(', ')}`);
    }
  }

  /* Les 9 dossiers sont désormais couverts. Le total attendu par le thème est de
     360 fichiers (3 produits × 40 couleurs × 3 vues) : tout écart avec ce
     chiffre signale un dossier incomplet, et le thème retomberait alors
     silencieusement sur l'image générique du produit. */
  const ATTENDU = 3 * 40 * 3;
  console.log('');
  console.log(
    total === ATTENDU
      ? `  Couverture COMPLÈTE : ${total}/${ATTENDU} fichiers attendus par le thème.`
      : `  Couverture PARTIELLE : ${total}/${ATTENDU} — les couleurs absentes ` +
        `retomberont sur l'image générique du produit.`,
  );

  if (!ECRIRE) {
    console.log('');
    console.log('  Relancer avec --ecrire pour copier.');
  }
}

principal();
