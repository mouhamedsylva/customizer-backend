/**
 * Aperçu local de la VECTORISATION DES TEXTES — sans base, sans Cloudinary,
 * sans serveur.
 *
 *   npm run apercu:texte
 *   npm run apercu:texte -- "MON TEXTE" Oswald 140
 *
 * Écrit `apercu-texte.html` à la racine : ouvrez-le dans un navigateur. Chaque
 * police y est rendue à partir de son SVG vectoriel réel, celui que recevra
 * l'atelier. Les fichiers .svg sont aussi déposés dans `apercu-texte/` pour
 * être ouverts dans Illustrator ou Inkscape.
 *
 * POURQUOI CE SCRIPT : la chaîne complète (thème → API → Cloudinary) demande
 * des clés Cloudinary et un tunnel vers le thème Shopify. Or la partie qui
 * répond à la demande du client — « le PNG est trop pixélisé » — est le
 * service de vectorisation, qui ne dépend de rien d'autre que des polices.
 * On le teste donc isolément, ce qui est à la fois plus simple et plus sûr.
 */
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let TextOutlineService;
try {
  ({ TextOutlineService } = require('../dist/shared/text-outline.service'));
} catch {
  console.error(
    "\n  Le projet n'est pas compilé.\n" +
      '  Lancez d\'abord :  npm run build\n',
  );
  process.exit(1);
}

const [texteArg, policeArg, tailleArg] = process.argv.slice(2);
const TEXTE = texteArg || 'Massacre 123';
const TAILLE = parseInt(tailleArg, 10) || 110;

const service = new TextOutlineService();

const polices = readdirSync('assets/fonts')
  .filter((f) => /\.ttf$/i.test(f))
  .map((f) => f.replace(/\.ttf$/i, ''))
  .filter((nom) => (policeArg ? nom.toLowerCase() === policeArg.toLowerCase() : true))
  .sort();

if (!polices.length) {
  console.error(`\n  Aucune police ne correspond à « ${policeArg} ».\n`);
  process.exit(1);
}

mkdirSync('apercu-texte', { recursive: true });

const cartes = [];
let reussites = 0;

for (const nom of polices) {
  const svg = await service.genererSvgVectoriel(
    [{ text: TEXTE, fontFamily: nom, fontSize: TAILLE, fontWeight: '400', color: '#111111' }],
    { scale: 1, padding: 24 },
  );

  if (!svg) {
    cartes.push(
      `<div class="carte echec"><h2>${nom}</h2>` +
        `<p>Non vectorisable — ce texte partirait en PNG seul.</p></div>`,
    );
    continue;
  }

  reussites++;
  writeFileSync(`apercu-texte/${nom}.svg`, svg, 'utf8');

  const traces = (svg.match(/<path/g) || []).length;
  const courbes = (svg.match(/[CQ]/g) || []).length;

  cartes.push(
    `<div class="carte">
       <h2>${nom}</h2>
       <div class="rendu">${svg}</div>
       <p class="meta">${traces} tracé(s) · ${courbes} courbes · ${(svg.length / 1024).toFixed(1)} Ko
          · <a href="apercu-texte/${nom}.svg" download>télécharger le .svg</a></p>
     </div>`,
  );
}

/* Le SVG est injecté tel quel dans la page : c'est exactement le fichier
   produit, donc ce que l'on voit est ce que l'atelier recevra. */
const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Aperçu des textes vectorisés</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 28px;
         background: #f6f6f7; color: #16181d; }
  @media (prefers-color-scheme: dark) { body { background: #12141a; color: #e6e8ee; } }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sous { color: #6b7280; margin: 0 0 24px; }
  .carte { background: #fff; border: 1px solid #e3e5e9; border-radius: 12px;
           padding: 16px 18px; margin-bottom: 14px; }
  @media (prefers-color-scheme: dark) { .carte { background: #1b1e26; border-color: #2c313c; } }
  .carte h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em;
              color: #6b7280; margin: 0 0 10px; }
  .rendu svg { max-width: 100%; height: auto; }
  @media (prefers-color-scheme: dark) { .rendu svg path, .rendu svg rect { fill: #e6e8ee; } }
  .meta { font-size: 12px; color: #6b7280; margin: 10px 0 0; }
  .echec { border-color: #d9534f; }
  .echec p { color: #d9534f; }
  .zoom { background: #fff; border: 1px solid #e3e5e9; border-radius: 12px;
          padding: 16px 18px; margin-bottom: 20px; overflow: auto; }
  @media (prefers-color-scheme: dark) { .zoom { background: #1b1e26; border-color: #2c313c; } }
  .zoom svg { width: 400%; height: auto; }
</style>
</head>
<body>
  <h1>Textes vectorisés — « ${TEXTE} »</h1>
  <p class="sous">${reussites} police(s) sur ${polices.length} · taille ${TAILLE}px ·
     les lettres sont des tracés, pas des pixels.</p>

  <div class="zoom">
    <h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin:0 0 10px">
      Agrandissement ×4 — la netteté doit rester parfaite
    </h2>
    ${cartes.length && !cartes[0].includes('echec')
      ? (await service.genererSvgVectoriel(
          [{ text: TEXTE, fontFamily: polices[0], fontSize: TAILLE, fontWeight: '400', color: '#111111' }],
          { scale: 1, padding: 24 },
        )) || ''
      : ''}
  </div>

  ${cartes.join('\n')}
</body>
</html>`;

writeFileSync('apercu-texte.html', html, 'utf8');

console.log('');
console.log(`  ${reussites}/${polices.length} police(s) vectorisée(s).`);
console.log('');
console.log('  Page  : apercu-texte.html   (ouvrez-la dans un navigateur)');
console.log('  SVG   : apercu-texte/*.svg  (ouvrez-les dans Illustrator)');
console.log('');
