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

describe('fichiers rattachés après coup', () => {
  const { assetsRattaches } = require('../src/shared/zones-texte');
  it('ne garde que les URL Cloudinary https avec un libellé', () => {
    expect(
      assetsRattaches({
        __assets: [
          { label: 'Logo cœur', url: 'https://res.cloudinary.com/c/image/upload/l.png' },
          { label: 'Pirate', url: 'https://evil.com/x.png' },
          { url: 'https://res.cloudinary.com/c/image/upload/sans-libelle.png' },
        ],
      }),
    ).toEqual([{ label: 'Logo cœur', url: 'https://res.cloudinary.com/c/image/upload/l.png' }]);
    expect(assetsRattaches(undefined)).toEqual([]);
  });
});

describe('textes retrouvés sur Cloudinary (#20318)', () => {
  const z = require('../src/shared/zones-texte');
  const { dashboardPage } = require('../src/admin/admin.view');
  const PNG = 'https://res.cloudinary.com/c/image/upload/v1/customizer/text/tshirt/text_chest-right_1758791000000.png';
  const SVG = 'https://res.cloudinary.com/c/raw/upload/v1/customizer/text/tshirt/text_chest-right_1758791000000.svg';
  const retrouve = { fr: { texte: 'TAURAATUA', police: 'Arial', taillePx: 12, couleur: '#ffffff', source: 'retrouve', pngPropre: PNG, svgPropre: SVG } };

  it('déduit la zone du nom de fichier', () => {
    expect(z.zoneDuFichierTexte(PNG)).toBe('fr');
    expect(z.zoneDuFichierTexte('…/text_front_123.png')).toBe('f');
    expect(z.zoneDuFichierTexte('…/logo_front_123.png')).toBeNull();
  });

  it('donne le visuel quand la ligne n’a pas de propriété texte, sans avertir sur la planche', () => {
    expect(z.pngRegeneresSansOrigine(retrouve, ['Détails'])).toEqual([
      { zone: 'fr', libelle: 'Texte poitrine droite (retrouvé)', url: PNG },
    ]);
    expect(z.pngRegeneresSansOrigine(retrouve, ['_Texte poitrine droite'])).toEqual([]);
    expect(z.aDesTextesRegeneres(retrouve)).toBe(false);
  });

  it('affiche visuel, SVG et typo sur la carte de la commande', () => {
    const o = {
      shopifyOrderId: '7', orderNumber: '#20318', productionStatus: 'producing', totalPrice: '37.00',
      receivedAt: new Date(), typoRetrouvee: { 0: retrouve },
      lineItems: [{ title: 'Textile - T-shirt Polyester', quantity: 1, properties: [{ name: 'Détails', value: 'Couleur : Noir' }] }],
    };
    const html = dashboardPage([o], [], [], 'https://x', '');
    expect(html).toContain(PNG);
    expect(html).toContain(SVG);
    expect(html).toContain('Arial');
    expect(html).not.toContain('police du texte incorrecte');
  });
});
