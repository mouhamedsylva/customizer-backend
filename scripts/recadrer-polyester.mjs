/**
 * Recadre les images du t-shirt POLYESTER pour les aligner sur le t-shirt coton.
 *
 * Le défaut
 * ---------
 * Le vêtement polyester occupe 100 % de la hauteur de son image (marges : 0 px
 * en haut, 0 px en bas), là où le t-shirt coton n'en occupe que 80 %. Le canevas
 * affiche l'image à `height: 60vh` : à hauteur d'image égale, le polyester
 * paraît donc environ 25 % plus grand, et déborde.
 *
 * Le même défaut explique la zone d'impression trop haute. Les zones sont
 * exprimées en POURCENTAGE de l'image (conf-main-inline.js), et le polyester
 * emprunte les mesures du coton : `top: 29 %` tombe juste sur un vêtement qui
 * occupe 80 % de la hauteur, trop haut sur un vêtement qui en occupe 100 %.
 * Recadrer corrige les deux symptômes — sans toucher aux zones.
 *
 * La méthode
 * ----------
 * Pour chaque image : mesurer la boîte des pixels opaques, la redimensionner
 * pour qu'elle occupe la même part de hauteur que le coton, puis la recentrer
 * dans une toile 500 × 500 transparente.
 *
 * UN SEUL FACTEUR D'ÉCHELLE, calculé sur la vue de FACE et appliqué aux trois
 * vues. Un facteur par vue ramènerait chaque vue à 80 % indépendamment : le
 * vêtement changerait de taille en pivotant face → dos → côté, puisque ses
 * proportions réelles diffèrent d'une vue à l'autre.
 *
 * APERÇU PAR DÉFAUT. Rien n'est écrit sans `--apply`, et les originaux sont
 * sauvegardés avant toute modification.
 *
 * Utilisation (depuis customizer-backend/) :
 *   node scripts/recadrer-polyester.mjs           # mesures, sans rien écrire
 *   node scripts/recadrer-polyester.mjs --apply   # recadre
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(ICI, '../../Configurateur-travail/assets');
const SAUVEGARDE = path.resolve(ICI, '../../Images-polyester-avant-recadrage');

const APPLY = process.argv.includes('--apply');

const PREFIXE = 'tshirt-polyester-';
const TAILLE = 500;          // toile finale, comme les deux autres textiles
const VUES = ['face', 'dos', 'cote'];

/* Référence : le t-shirt coton. Même famille de vêtement, et c'est déjà la
   source des zones d'impression du polyester. Mesuré sur tshirt-noir-face.png :
   vêtement de 399 px de haut dans une image de 500, marge haute de 46 px. */
const REF = { fichier: 'tshirt-noir-face.png', vue: 'face' };

/**
 * Boîte englobante des pixels opaques — le vêtement, sans la transparence.
 * @returns {{W,H,x,y,w,h}} dimensions de l'image et de la boîte
 */
async function boite(chemin) {
  const { data, info } = await sharp(chemin)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: W, height: H, channels: ch } = info;
  let minX = W, maxX = -1, minY = H, maxY = -1;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      /* Seuil à 20 plutôt que 0 : les bords détourés gardent un halo de pixels
         très faiblement opaques, qui fausserait la boîte de plusieurs pixels. */
      if (data[(y * W + x) * ch + 3] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;   // image entièrement transparente
  return { W, H, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function fichiers(vue) {
  return fs.readdirSync(ASSETS)
    .filter((f) => f.startsWith(PREFIXE) && f.endsWith(`-${vue}.png`))
    .sort();
}

(async function main() {
  console.log(`Assets : ${ASSETS}`);
  console.log(APPLY ? '⚠  MODE APPLICATION — les images vont être réécrites'
                    : 'Mode APERÇU — aucune modification');

  /* ── 1. La référence ────────────────────────────────────────────────── */
  const bRef = await boite(path.join(ASSETS, REF.fichier));
  if (!bRef) { console.error(`❌ référence illisible : ${REF.fichier}`); process.exit(1); }

  const partHauteur = bRef.h / bRef.H;      // ~0,80
  const margeHaute = bRef.y / bRef.H;       // ~0,09
  console.log(`\nRéférence (${REF.fichier}) : vêtement ${bRef.w}×${bRef.h} dans ${bRef.W}×${bRef.H}`);
  console.log(`  occupe ${(partHauteur * 100).toFixed(1)} % de la hauteur, marge haute ${(margeHaute * 100).toFixed(1)} %`);

  /* ── 2. Le facteur, calculé sur la FACE ─────────────────────────────── */
  const facePoly = fichiers('face');
  if (!facePoly.length) { console.error('❌ aucune image polyester de face'); process.exit(1); }

  const bFace = await boite(path.join(ASSETS, facePoly[0]));
  const partActuelle = bFace.h / bFace.H;
  /* La hauteur VISÉE du vêtement dans la toile finale. Le facteur en découle,
     appliqué tel quel aux trois vues pour préserver leurs proportions. */
  const hauteurCible = TAILLE * partHauteur;
  const facteur = hauteurCible / bFace.h;

  console.log(`\nPolyester (${facePoly[0]}) : vêtement ${bFace.w}×${bFace.h} dans ${bFace.W}×${bFace.H}`);
  console.log(`  occupe ${(partActuelle * 100).toFixed(1)} % de la hauteur`);
  console.log(`\nFacteur d'échelle unique : ×${facteur.toFixed(4)}`);
  console.log(`  → vêtement de face visé : ${Math.round(bFace.w * facteur)}×${Math.round(hauteurCible)} px dans ${TAILLE}×${TAILLE}`);

  /* ── 3. Traitement ──────────────────────────────────────────────────── */
  if (APPLY && !fs.existsSync(SAUVEGARDE)) fs.mkdirSync(SAUVEGARDE, { recursive: true });

  let traites = 0, ignores = 0;
  for (const vue of VUES) {
    const liste = fichiers(vue);
    console.log(`\n═══ vue ${vue} — ${liste.length} images ═══`);
    let premier = true;

    for (const nom of liste) {
      const chemin = path.join(ASSETS, nom);
      const b = await boite(chemin);
      if (!b) { console.log(`  ⚠ ${nom} : entièrement transparente, ignorée`); ignores++; continue; }

      const nw = Math.max(1, Math.round(b.w * facteur));
      const nh = Math.max(1, Math.round(b.h * facteur));

      /* Centré horizontalement ; verticalement, on reprend la marge haute de la
         référence pour que le vêtement soit ancré comme celui du coton. */
      const gauche = Math.round((TAILLE - nw) / 2);
      let haut = Math.round(TAILLE * margeHaute);
      /* Une vue plus haute que la face (le côté) déborderait par le bas : on la
         recentre alors, plutôt que de la rogner. */
      if (haut + nh > TAILLE) haut = Math.max(0, Math.round((TAILLE - nh) / 2));

      if (premier) {
        console.log(`  exemple : ${b.w}×${b.h} dans ${b.W}×${b.H}` +
                    `  →  ${nw}×${nh} dans ${TAILLE}×${TAILLE}` +
                    `  (occupe ${Math.round(nh / TAILLE * 100)} % de la hauteur)`);
        premier = false;
      }

      if (!APPLY) { traites++; continue; }

      fs.copyFileSync(chemin, path.join(SAUVEGARDE, nom));

      /* Le vêtement est extrait, redimensionné, puis posé sur une toile neuve —
         plutôt que de redimensionner l'image entière, ce qui conserverait ses
         marges d'origine (nulles) et ne changerait rien à l'occupation. */
      const vetement = await sharp(chemin)
        .ensureAlpha()
        .extract({ left: b.x, top: b.y, width: b.w, height: b.h })
        .resize(nw, nh, { fit: 'fill' })
        .png()
        .toBuffer();

      const sortie = await sharp({
        create: {
          width: TAILLE, height: TAILLE, channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: vetement, left: gauche, top: haut }])
        .png({ compressionLevel: 9 })
        .toBuffer();

      /* Écriture après coup : `sharp` ne peut pas lire et écrire le même fichier
         dans la même chaîne — le fichier serait tronqué. */
      fs.writeFileSync(chemin, sortie);
      traites++;
    }
  }

  console.log(`\n─── ${traites} image(s) ${APPLY ? 'recadrées' : 'à recadrer'}` +
              `${ignores ? `, ${ignores} ignorée(s)` : ''} ───`);
  if (APPLY) console.log(`Originaux sauvegardés : ${SAUVEGARDE}`);
  else console.log('Relancer avec --apply pour écrire.');
})().catch((e) => { console.error('❌ ' + e.message); process.exit(1); });
