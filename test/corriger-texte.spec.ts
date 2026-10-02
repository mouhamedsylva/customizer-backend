import { couleurHex, texteDeLigne } from '../src/scripts/corriger-texte-commande';
import { TextOutlineService } from '../src/shared/text-outline.service';
import { aDesTextesRegeneres, pngRegenere, svgRegeneresSansOrigine } from '../src/shared/zones-texte';

/** Propriétés réelles d'une ligne de la commande #20285 (groupe, Courgette). */
const LIGNE = [
  { name: 'Personne', value: 'Thomas' },
  { name: 'Emplacement', value: 'Devant' },
  { name: '_Texte face', value: 'https://res.cloudinary.com/c/image/upload/v1/customizer/text/x/t.png' },
  { name: '_TexteFontFamily', value: 'Courgette' },
  { name: '_TexteFontSize', value: '15px' },
  { name: '_TexteFontWeight', value: '400' },
  { name: '_TexteFontStyle', value: 'normal' },
  { name: '_TexteDecoration', value: 'none' },
  { name: '_TexteColor', value: 'rgb(255, 255, 255)' },
  { name: '_TexteZone', value: 'f' },
];

describe('corriger-texte-commande', () => {
  it('relit texte et typo dans les propriétés de la ligne', () => {
    expect(texteDeLigne(LIGNE)).toEqual({
      zone: 'f', texte: 'Thomas', police: 'Courgette', taillePx: 15,
      graisse: '400', italique: false, souligne: false, couleur: '#ffffff',
    });
    expect(texteDeLigne([{ name: 'Personne', value: 'X' }])).toBeNull();
  });

  it('convertit les couleurs CSS', () => {
    expect(couleurHex('rgb(255, 255, 255)')).toBe('#ffffff');
    expect(couleurHex('#abc')).toBe('#aabbcc');
    expect(couleurHex('n’importe quoi')).toBe('#000000');
  });

  it('trace « Thomas » en vraie Courgette (la police est bien disponible)', async () => {
    const s = new TextOutlineService();
    (s as any).logger = { log() {}, debug() {}, warn() {}, error() {} };
    const t = texteDeLigne(LIGNE)!;
    const svg = await s.genererSvgVectoriel(
      [{ text: t.texte, fontFamily: t.police, fontSize: t.taillePx, fontWeight: '400', color: t.couleur }],
      { scale: 4, padding: 32 },
    );
    expect(svg).not.toBeNull();
    expect(svg).toMatch(/<path d="M/);
    expect(svg).not.toMatch(/<text/); // des tracés, pas un texte confié à la police du serveur
  });
});

describe('dashboard : textes redessinés', () => {
  const corrige = { f: { pngPropre: 'https://res.cloudinary.com/c/image/upload/p.png', svgPropre: 'https://res.cloudinary.com/c/raw/upload/s.svg' } };

  it('remplace le visuel « _Texte face » et signale la planche', () => {
    expect(pngRegenere(corrige, '_Texte face')).toBe(corrige.f.pngPropre);
    expect(pngRegenere(corrige, '_Aperçu')).toBeNull();
    expect(aDesTextesRegeneres(corrige)).toBe(true);
    expect(aDesTextesRegeneres({})).toBe(false);
  });

  it('ajoute le SVG régénéré quand la ligne n’en avait pas', () => {
    expect(svgRegeneresSansOrigine(corrige, ['_Texte face'])).toEqual([
      { zone: 'f', libelle: 'Texte face (SVG)', url: corrige.f.svgPropre },
    ]);
    expect(svgRegeneresSansOrigine(corrige, ['_Texte face (SVG)'])).toEqual([]);
  });
});
