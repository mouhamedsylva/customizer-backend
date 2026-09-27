/**
 * Vérifie que le SVG de découpe correspond à ce que le client voit.
 *
 *   npm run build && npm run verif:polices
 *   npm run verif:polices -- "Martin" Pacifico,Lora 20,24,28
 *
 * Pour chaque police × taille, contrôle :
 *  - NaN     : aucune coordonnée invalide (un NaN arrête le dessin du tracé —
 *              c'était le « ✗ n » du tableau Police × taille) ;
 *  - glyphes : aucun caractère absent de la police (.notdef) ;
 *  - cadre   : le contour réel tient entièrement dans le viewBox (aucun rognage) ;
 *  - remplissage : les lettres occupent l'essentiel du cadre (pas de timbre-poste) ;
 *  - graisse : celle tracée = celle affichée en boutique (lien Google Fonts).
 *
 * Et, si le thème est à côté (../Configurateur-travail), que GRAISSES_BOUTIQUE
 * est synchronisé avec le lien Google Fonts de layout/configurateur.liquid.
 *
 * Code de sortie 1 au moindre ✗ : utilisable en CI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let mod;
try {
  mod = require('../dist/shared/text-outline.service');
} catch {
  console.error("\n  Le projet n'est pas compilé. Lancez d'abord :  npm run build\n");
  process.exit(1);
}
const { TextOutlineService, GRAISSES_BOUTIQUE } = mod;
const opentype = require('opentype.js');

const [texteArg, policesArg, taillesArg] = process.argv.slice(2);
const TEXTE = texteArg || 'Martin';
const POLICES = (policesArg || 'Pacifico,Bungee,Dancing Script,Allura,Lora').split(',');
const TAILLES = (taillesArg || '20,22,24,26,28').split(',').map(Number);

/* Le service journalise via Nest : on le fait taire, sauf les alertes. */
const service = new TextOutlineService();
const alertes = [];
service.logger = { log() {}, debug() {}, warn: (m) => alertes.push(m), error: (m) => alertes.push(m) };

/** Rapport contour / cadre, recalculé indépendamment du service. */
function analyser(svg) {
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const [w, h] = [Number(vb[1]), Number(vb[2])];
  const cadre = new opentype.BoundingBox();
  for (const [, d] of svg.matchAll(/<path d="([^"]*)"/g)) {
    for (const [, x, y] of d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)) cadre.addPoint(+x, +y);
  }
  const deborde = cadre.x1 < -0.01 || cadre.y1 < -0.01 || cadre.x2 > w + 0.01 || cadre.y2 > h + 0.01;
  const remplissage = ((cadre.x2 - cadre.x1) * (cadre.y2 - cadre.y1)) / (w * h);
  return { w, h, deborde, remplissage };
}

const erreurs = [];
const lignes = [];

for (const police of POLICES) {
  const cellules = [];
  for (const taille of TAILLES) {
    const pb = [];
    const svg = await service.genererSvgVectoriel(
      [{ text: TEXTE, fontFamily: police, fontSize: taille, fontWeight: '400', color: '#111111' }],
      { scale: 4, padding: 32 },
    );
    if (!svg) {
      pb.push('pas de SVG');
    } else {
      const chargee = await service.chargerPolice(police, '400');
      const manquants = Array.from(TEXTE).filter((c) => c.trim() && chargee.police.charToGlyph(c).index === 0);
      if (manquants.length) pb.push(`glyphes absents « ${manquants.join('')} »`);

      const attendue = service.graisseAffichee(police, 400);
      if (chargee.graisse !== attendue) pb.push(`graisse ${chargee.graisse} ≠ boutique ${attendue}`);

      /* Le critère du tableau d'origine : un NaN coupe le tracé net. */
      const nan = (svg.match(/NaN|Infinity/g) || []).length;
      if (nan) pb.push(`${nan} coordonnée(s) NaN`);

      const a = analyser(svg);
      if (a.deborde) pb.push('contour rogné');
      if (a.remplissage < 0.45) pb.push(`remplissage ${(a.remplissage * 100).toFixed(0)} %`);
    }
    cellules.push(pb.length ? '✗' : '✓');
    for (const p of pb) erreurs.push(`${police} ${taille}px : ${p}`);
  }
  lignes.push(`  ${police.padEnd(16)}${cellules.map((c) => c.padEnd(7)).join('')}`);
}

console.log(`\n  « ${TEXTE} »\n`);
console.log(`  ${'Police'.padEnd(16)}${TAILLES.map((t) => `${t}px`.padEnd(7)).join('')}`);
console.log(lignes.join('\n'));

/* Synchronisation avec le thème. */
const liquid = '../Configurateur-travail/layout/configurateur.liquid';
if (existsSync(liquid)) {
  const url = readFileSync(liquid, 'utf8').match(/fonts\.googleapis\.com\/css2\?([^"]+)"/)?.[1] ?? '';
  for (const p of url.split('&')) {
    const m = p.match(/^family=([^:&]+)(?::wght@([\d;]+))?/);
    if (!m) continue;
    const cle = m[1].replace(/\+/g, '').toLowerCase();
    const boutique = (m[2] || '400').split(';').map(Number).join(',');
    const ici = (GRAISSES_BOUTIQUE[cle] ?? [400]).join(',');
    if (boutique !== ici) {
      erreurs.push(`GRAISSES_BOUTIQUE.${cle} = [${ici}] mais le thème charge [${boutique}]`);
    }
  }
} else {
  console.log(`\n  (thème introuvable en ${liquid} : synchronisation non vérifiée)`);
}

if (alertes.length) console.log('\n  Alertes du service :\n' + [...new Set(alertes)].map((a) => '   - ' + a).join('\n'));
if (erreurs.length) {
  console.log('\n  ✗ ' + erreurs.length + ' problème(s) :\n' + erreurs.map((e) => '   - ' + e).join('\n') + '\n');
  process.exit(1);
}
console.log('\n  ✓ Tout est conforme.\n');
