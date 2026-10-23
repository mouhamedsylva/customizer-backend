import { dashboardPage } from '../src/admin/admin.view';
import type { Order } from '../src/database/entities/order.entity';

/**
 * Typo du texte d'une commande SIMPLE sur la carte du dashboard.
 *
 * Le thème envoie désormais les `_Texte*` pour tout article personnalisé,
 * plus seulement pour les groupes. Le dashboard doit les rendre lisibles —
 * police, taille, gras, couleur — et non en pastilles techniques brutes.
 */
function page(proprietes: Array<{ name: string; value: string }>): string {
  const commande = {
    shopifyOrderId: '20544',
    orderNumber: 20544,
    totalPrice: '36.20',
    lineItems: [
      {
        title: 'Textile - T-shirt Coton',
        variantTitle: 'Vert olive',
        quantity: 1,
        properties: [
          { name: 'Détails', value: 'Couleur : Vert olive' },
          { name: 'Taille', value: 'Taille : M' },
          ...proprietes,
        ],
      },
    ],
    productionStatus: 'to_produce',
    financialStatus: 'paid',
    receivedAt: new Date(),
    shopifyCreatedAt: new Date(),
  } as unknown as Order;
  return dashboardPage([commande], [], [], 'https://exemple.fr', 'boutique', {
    limits: { orders: 300, quotes: 500 },
  });
}

const TYPO = [
  { name: '_TexteFontFamily', value: "Lora, serif" },
  { name: '_TexteFontSize', value: '20px' },
  { name: '_TexteFontWeight', value: '800' },
  { name: '_TexteFontStyle', value: 'italic' },
  { name: '_TexteColor', value: 'rgb(255, 255, 255)' },
  { name: '_TexteDecoration', value: 'underline' },
  { name: '_TexteZone', value: 'b' },
  { name: '_TexteCurved', value: 'false' },
  { name: '_TexteDataMaxFit', value: '37.5' },
  { name: '_TexteLeft', value: '42%' },
];

describe('dashboard — typo du texte d’une commande simple', () => {
  const html = page(TYPO);

  it('affiche la police, la taille et le style choisis', () => {
    expect(html).toContain('<b>Police</b> Lora');
    expect(html).toContain('<b>Taille</b> 20px');
    expect(html).toContain('<b>Gras</b> oui');
    expect(html).toContain('<b>Italique</b> oui');
    expect(html).toContain('<b>Souligné</b> oui');
    expect(html).toContain('<b>Emplacement</b> Dos');
    expect(html).toContain('style="background:rgb(255, 255, 255)"');
  });

  it('n’affiche plus les propriétés techniques brutes', () => {
    expect(html).not.toMatch(/<b>_Texte/);
    expect(html).not.toContain('37.5');
    expect(html).toContain('<b>Détails</b> Couleur : Vert olive'); // le reste est intact
  });

  it('échappe les valeurs et refuse du CSS dans la couleur', () => {
    const piege = page([
      { name: '_TexteFontFamily', value: '<script>alert(1)</script>' },
      { name: '_TexteColor', value: 'red;background:url(https://evil.example)' },
    ]);
    expect(piege).not.toContain('<script>alert(1)</script>');
    expect(piege).not.toContain('style="background:red;');
  });

  it('ne montre rien sans typo', () => {
    expect(page([])).not.toContain('<b>Police</b>');
  });
});

describe('dashboard — typo retrouvée depuis le SVG (anciennes commandes)', () => {
  const ancienne = (typoRetrouvee: any) =>
    dashboardPage(
      [
        {
          shopifyOrderId: '20544',
          orderNumber: 20544,
          totalPrice: '36.20',
          lineItems: [
            {
              title: 'Textile - T-shirt Coton',
              quantity: 1,
              properties: [{ name: '_Texte face (SVG)', value: 'https://res.cloudinary.com/x/raw/upload/t.svg' }],
            },
          ],
          typoRetrouvee,
          productionStatus: 'to_produce',
          financialStatus: 'paid',
          receivedAt: new Date(),
          shopifyCreatedAt: new Date(),
        } as unknown as Order,
      ],
      [],
      [],
      'https://exemple.fr',
      'boutique',
      { limits: { orders: 300, quotes: 500 } },
    );

  it('affiche texte, police, taille, couleur et l’origine', () => {
    const html = ancienne({
      0: { f: { texte: 'Welsh', police: 'Oswald', taillePx: 19.2, couleur: '#ffffff', souligne: false } },
    });
    expect(html).toContain('<b>Texte</b> « Welsh »');
    expect(html).toContain('<b>Police</b> Oswald');
    expect(html).toContain('<b>Taille</b> 19.2px');
    expect(html).toContain('<b>Emplacement</b> Face');
    expect(html).toContain('retrouvé depuis le SVG');
  });

  it('un bloc par zone, et rien sans typo retrouvée', () => {
    const html = ancienne({
      0: {
        f: { texte: 'AVANT', police: 'Anton', taillePx: 20, couleur: '#000' },
        b: { texte: 'DOS', police: 'Bungee', taillePx: 24, couleur: '#000' },
      },
    });
    expect(html).toContain('<b>Emplacement</b> Face');
    expect(html).toContain('<b>Emplacement</b> Dos');
    expect(ancienne(null)).not.toContain('<b>Police</b>');
  });

  it('ligne de groupe : la typo du surnom n’efface pas celle du dos retrouvée', () => {
    const html = dashboardPage(
      [
        {
          shopifyOrderId: '20919', orderNumber: 20919, totalPrice: '40',
          lineItems: [{ title: 'Textile - T-shirt Polyester', quantity: 1, properties: [
            { name: '_TexteContenu', value: 'Anaïs' },
            { name: '_TexteFontFamily', value: 'Pacifico' },
            { name: '_TexteFontSize', value: '16px' },
            { name: '_TexteZone', value: 'f' },
          ] }],
          typoRetrouvee: { 0: {
            f: { texte: 'IGNORÉ', police: 'Anton', taillePx: 20, couleur: '#000' },
            b: { texte: 'C’EST QUI MON BINÔME ?', police: 'Bungee', taillePx: 24, couleur: '#fff', source: 'retrouve' },
          } },
          productionStatus: 'to_produce', financialStatus: 'paid', receivedAt: new Date(), shopifyCreatedAt: new Date(),
        } as unknown as Order,
      ],
      [], [], 'https://exemple.fr', 'boutique', { limits: { orders: 300, quotes: 500 } },
    );
    expect(html).toContain('<b>Police</b> Pacifico');
    expect(html).toContain('<b>Police</b> Bungee');
    expect(html).toContain('<b>Emplacement</b> Dos');
    // La zone déjà décrite par le thème n'est pas doublée par une typo retrouvée.
    expect(html).not.toContain('IGNORÉ');
  });
});

describe('fiche de production — typo retrouvée', () => {
  it('imprime le bloc « Texte à flocker » avec le texte et l’origine', () => {
    const { productionSheetPage } = require('../src/admin/admin.view');
    const html: string = productionSheetPage({
      shopifyOrderId: '20544',
      orderNumber: 20544,
      totalPrice: '36.20',
      lineItems: [{ title: 'T-shirt', quantity: 1, properties: [] }],
      typoRetrouvee: { 0: { f: { texte: 'Welsh', police: 'Oswald', taillePx: 19.2, couleur: '#ffffff' } } },
      customerInfo: {},
      receivedAt: new Date(),
      shopifyCreatedAt: new Date(),
    });
    expect(html).toContain('Texte à flocker');
    expect(html).toContain('Welsh');
    expect(html).toContain('Oswald');
    expect(html).toContain('retrouvé depuis le SVG');
  });
});

describe('SVG régénéré à la place d’un SVG corrompu', () => {
  const { svgRegenere, zoneDuSvg } = require('../src/shared/zones-texte');
  const PROPRE = 'https://res.cloudinary.com/demo/raw/upload/v2/text_front_propre.svg';

  it('repère la zone et le remplaçant', () => {
    expect(zoneDuSvg('_Texte dos (SVG)')).toBe('b');
    expect(zoneDuSvg('_Texte face')).toBeNull();
    expect(svgRegenere({ f: { svgPropre: PROPRE } }, '_Texte face (SVG)')).toBe(PROPRE);
    expect(svgRegenere({ f: { svgPropre: 'https://evil.example/x.svg' } }, '_Texte face (SVG)')).toBeNull();
  });

  it('le dashboard sert le SVG régénéré, plus l’original', () => {
    const html = dashboardPage(
      [
        {
          shopifyOrderId: '1', orderNumber: 1, totalPrice: '1',
          lineItems: [{ title: 'T', quantity: 1, properties: [
            { name: '_Texte face (SVG)', value: 'https://res.cloudinary.com/demo/raw/upload/v1/corrompu.svg' },
          ] }],
          typoRetrouvee: { 0: { f: { texte: 'Martin', police: 'Lora', taillePx: 20, couleur: '#000', svgPropre: PROPRE } } },
          productionStatus: 'to_produce', financialStatus: 'paid', receivedAt: new Date(), shopifyCreatedAt: new Date(),
        } as unknown as Order,
      ],
      [], [], 'https://exemple.fr', 'boutique', { limits: { orders: 300, quotes: 500 } },
    );
    expect(html).toContain(PROPRE);
    expect(html).not.toContain('corrompu.svg');
    expect(html).toContain('régénéré, gras/italique inconnus');
  });
});

describe('fichier envoyé par erreur, remplacé ou masqué (#20981)', () => {
  const { proprietesCorrigees } = require('../src/shared/zones-texte');
  const FAUX = 'https://res.cloudinary.com/demo/image/upload/v1/logo_vert.png';
  const BON = 'https://res.cloudinary.com/demo/image/upload/v2/logo_bleu.png';
  const AVANT = 'https://res.cloudinary.com/demo/image/upload/v1/logo_vert_avant.png';
  const props = [
    { name: '_Logo dos', value: FAUX },
    { name: '_Logo cœur (avant détourage)', value: AVANT },
    { name: 'Taille', value: 'M' },
  ];

  it('remplace, masque, et ignore une URL étrangère', () => {
    const r = proprietesCorrigees(props, {
      __remplace: { '_Logo dos': BON, '_Logo cœur (avant détourage)': null },
    });
    expect(r).toEqual([{ name: '_Logo dos', value: BON }, { name: 'Taille', value: 'M' }]);
    expect(proprietesCorrigees(props, { __remplace: { '_Logo dos': 'https://evil.example/x.png' } })[0].value).toBe(FAUX);
    expect(proprietesCorrigees(props, null)).toBe(props);
  });

  it('la carte du dashboard montre le remplaçant, plus le fichier erroné', () => {
    const html = dashboardPage(
      [
        {
          shopifyOrderId: '20981', orderNumber: 20981, totalPrice: '60',
          lineItems: [{ title: 'Textile - T-shirt Polyester', quantity: 1, properties: props }],
          typoRetrouvee: { 0: { __remplace: { '_Logo dos': BON, '_Logo cœur (avant détourage)': null } } },
          productionStatus: 'to_produce', financialStatus: 'paid', receivedAt: new Date(), shopifyCreatedAt: new Date(),
        } as unknown as Order,
      ],
      [], [], 'https://exemple.fr', 'boutique', { limits: { orders: 300, quotes: 500 } },
    );
    expect(html).toContain(BON);
    expect(html).not.toContain(FAUX);
    expect(html).not.toContain(AVANT);
  });
});
