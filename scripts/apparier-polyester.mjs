/**
 * Apparie les visuels `Code_Generated_Image (N).png` du t-shirt polyester à leur
 * couleur, en comparant leur teinte à celle des vues de FACE — les seules dont
 * le nom porte le slug.
 *
 * Pourquoi ce script existe
 * -------------------------
 * Les vues `dos` et `coté` du polyester n'ont aucune information de couleur dans
 * leur nom. J'avais d'abord supposé un ordre alphabétique inversé, en testant
 * trois images qui coïncidaient — les captures du dossier ont montré que cet
 * ordre n'existe pas. Deviner d'après le numéro était donc faux.
 *
 * Méthode : la couleur MOYENNE du vêtement. On échantillonne le centre de
 * l'image (le tissu occupe le milieu, le fond est blanc ou transparent), puis on
 * cherche la face dont la teinte est la plus proche en distance RGB.
 *
 * Garde-fou : un appariement dont la distance dépasse SEUIL_DOUTE est signalé
 * plutôt qu'appliqué. Deux couleurs proches (navy / navy-blue, black /
 * used-black) doivent être vérifiées à l'œil, pas tranchées par une moyenne.
 *
 * Usage (depuis customizer-backend/) :
 *   node scripts/apparier-polyester.mjs
 *   node scripts/apparier-polyester.mjs --json > ../polyester-appariement.json
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const JSON_OUT = process.argv.includes('--json');
const SRC = path.join('..', 'Customizer-images', 't-shirt polyester');

/* Au-delà de cette distance RGB, l'appariement est douteux : on le signale.
   Repère : deux gris voisins sont à ~15, deux couleurs franches à >100. */
const SEUIL_DOUTE = 30;

/**
 * Couleur moyenne du VÊTEMENT.
 *
 * On ignore les pixels quasi blancs et les transparents : ce sont le fond. Sans
 * ce filtre, un t-shirt blanc et un fond blanc donnent la même moyenne, et tous
 * les clairs se confondent.
 */
function couleurMoyenne(fichier) {
  /* `sharp` est déjà une dépendance du backend (cloudinary.service.ts s'en sert
     pour composer les aperçus) : pas de nouvelle brique à installer. */
  return sharp(fichier)
    .resize(64, 64, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      const c = info.channels;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += c) {
        const alpha = c === 4 ? data[i + 3] : 255;
        if (alpha < 200) continue;                     // fond transparent
        const [pr, pg, pb] = [data[i], data[i + 1], data[i + 2]];
        if (pr > 235 && pg > 235 && pb > 235) continue; // fond blanc
        r += pr; g += pg; b += pb; n++;
      }
      if (!n) return null;
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    });
}

const distance = (a, b) =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

async function principal() {
  const faceDir = path.join(SRC, 'face');
  if (!fs.existsSync(faceDir)) {
    console.error(`Introuvable : ${path.resolve(faceDir)}`);
    process.exit(1);
  }

  /* 1) Teinte de référence par slug, depuis les faces nommées. */
  const refs = [];
  for (const f of fs.readdirSync(faceDir).filter((x) => /^[a-z-]+\.png$/.test(x))) {
    const rgb = await couleurMoyenne(path.join(faceDir, f));
    if (rgb) refs.push({ slug: f.replace('.png', ''), rgb });
  }

  if (!JSON_OUT) {
    console.log(`Références : ${refs.length} faces nommées\n`);
  }

  /* 2) Chaque fichier numéroté cherche sa face la plus proche. */
  const resultat = {};
  for (const vue of ['dos', 'coté']) {
    const dir = path.join(SRC, vue);
    if (!fs.existsSync(dir)) continue;

    const fichiers = fs
      .readdirSync(dir)
      .filter((x) => x.toLowerCase().endsWith('.png'))
      .sort((a, b) => {
        const na = Number((a.match(/\((\d+)\)/) || [])[1] || 0);
        const nb = Number((b.match(/\((\d+)\)/) || [])[1] || 0);
        return na - nb;
      });

    const pris = new Set();
    const lignes = [];

    for (const f of fichiers) {
      const rgb = await couleurMoyenne(path.join(dir, f));
      if (!rgb) { lignes.push({ f, slug: null, d: null, note: 'illisible' }); continue; }

      /* Appariement au plus proche NON DÉJÀ PRIS : chaque couleur n'existe
         qu'une fois par vue, deux fichiers ne peuvent pas viser le même slug. */
      const classees = refs
        .map((r) => ({ slug: r.slug, d: distance(rgb, r.rgb) }))
        .sort((a, b) => a.d - b.d);
      const choix = classees.find((c) => !pris.has(c.slug)) || classees[0];
      pris.add(choix.slug);

      lignes.push({
        f,
        slug: choix.slug,
        d: Math.round(choix.d),
        note: choix.d > SEUIL_DOUTE ? 'À VÉRIFIER' : '',
        second: classees[1] ? `${classees[1].slug} (${Math.round(classees[1].d)})` : '',
      });
    }

    resultat[vue] = lignes;

    if (!JSON_OUT) {
      const douteux = lignes.filter((l) => l.note).length;
      console.log(`=== ${vue} — ${lignes.length} fichiers, ${douteux} à vérifier ===`);
      for (const l of lignes) {
        const num = (l.f.match(/\((\d+)\)/) || [])[1] || '?';
        console.log(
          `  ${String(num).padStart(3)}  ->  ${String(l.slug).padEnd(18)}` +
            `d=${String(l.d).padStart(3)}  ${l.note}` +
            (l.note ? `   2e: ${l.second}` : ''),
        );
      }
      console.log('');
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(resultat, null, 1));
  } else {
    console.log('Vérifiez les lignes « À VÉRIFIER » avant de renommer :');
    console.log('  une distance élevée signale deux teintes proches (navy/navy-blue,');
    console.log('  black/used-black) que la moyenne ne sait pas trancher.');
  }
}

principal().catch((e) => {
  console.error('Erreur :', e.message);
  process.exit(1);
});
