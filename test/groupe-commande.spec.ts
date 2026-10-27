import { dashboardPage } from '../src/admin/admin.view';
import { anomaliesGroupe, designCommun, lignesDuGroupe } from '../src/admin/groupe-commande';
import type { Order } from '../src/database/entities/order.entity';

/**
 * Commande de groupe compacte : design commun, contrôles automatiques et
 * visualiseur de planche. Données calquées sur la #21189 (AITO reçu avec le
 * visuel de MOMO).
 */
const C = 'https://res.cloudinary.com/syhrwmdi/image/upload/v1/customizer/';
const COEUR = C + 'logos/generic/coeur.png';
const DOS = C + 'logos/generic/dos.png';
const TDOS = C + 'text/sweatshirt/text_back.png';
const TDOS_SVG = 'https://res.cloudinary.com/syhrwmdi/raw/upload/v1/customizer/text/sweatshirt/text_back.svg';
const TEXTE_MOMO = C + 'text/sweatshirt/text_front_momo.png';

function ligne(nom: string, texte: string, apercu = C + `shares/share_multi_${nom}.jpg`) {
  return {
    title: 'Textile - T-shirt Coton',
    quantity: 1,
    properties: [
      { name: 'Personne', value: nom },
      { name: 'Liste', value: 'Groupe 3 pers. #10rjc' },
      { name: 'Taille', value: 'M' },
      { name: 'Détails', value: 'Couleur : Noir' },
      { name: '_Aperçu', value: apercu },
      { name: '_Logo cœur', value: COEUR },
      { name: '_Logo dos', value: DOS },
      { name: '_Texte dos', value: TDOS },
      { name: '_Texte dos (SVG)', value: TDOS_SVG },
      { name: '_Texte face', value: texte },
      { name: '_TexteFontFamily', value: 'Anton' },
      { name: '_TexteFontSize', value: '15px' },
      { name: '_TexteZone', value: 'f' },
    ],
  };
}

const items = () => [
  ligne('AITO', TEXTE_MOMO),
  ligne('LA DUP', C + 'text/sweatshirt/text_front_ladup.png'),
  ligne('MOMO', TEXTE_MOMO),
  { title: 'Personnalisation manche', quantity: 2, properties: [{ name: 'Manches', value: 'Gauche + droite' }] },
];

describe('commande de groupe : logique', () => {
  it('le design commun garde logos et textes du dos, sans planche ni nom', () => {
    const d = designCommun(lignesDuGroupe(items()));
    expect(d.images.map((f) => f.nom)).toEqual(['Logo cœur', 'Logo dos', 'Texte dos']);
    expect(d.svgs.map((f) => f.nom)).toEqual(['Texte dos (SVG)']);
  });

  it('repère AITO et MOMO qui partagent le même visuel de texte', () => {
    const l = lignesDuGroupe(items());
    const a = anomaliesGroupe(l);
    expect(l.map((x) => x.index)).toEqual([0, 1, 2]); // supplément manche exclu
    expect(a.get(0)).toEqual(['Même visuel de texte que MOMO']);
    expect(a.get(2)).toEqual(['Même visuel de texte que AITO']);
    expect(a.has(1)).toBe(false);
  });

  it('un texte redessiné pour AITO lève l’alerte', () => {
    const li = items();
    (li[0] as any).__typoRetrouvee = { f: { pngPropre: C + 'text/sweatshirt/text_front_aito.png', source: 'retrouve' } };
    expect(anomaliesGroupe(lignesDuGroupe(li)).size).toBe(0);
  });

  it('nom en double, texte manquant, planche face seule', () => {
    const li = [
      ligne('PAUL', C + 'a.png'),
      ligne('paul', C + 'b.png'),
      ligne('JEAN', '', C + 'shares/share_123.png'),
    ];
    li[2].properties.push({ name: '_Texte face (manquant)', value: 'JEAN' });
    const a = anomaliesGroupe(lignesDuGroupe(li));
    expect(a.get(0)).toContain('Nom en double dans la liste');
    expect(a.get(2)).toEqual(expect.arrayContaining(['Visuel du nom manquant', 'Planche incomplète (face seule)']));
  });
});

describe('commande de groupe : rendu de la carte', () => {
  const page = (lignes: any[]) =>
    dashboardPage(
      [
        {
          shopifyOrderId: '21189', orderNumber: '#21189', totalPrice: '256', lineItems: lignes,
          productionStatus: 'to_produce', financialStatus: 'paid', receivedAt: new Date(), shopifyCreatedAt: new Date(),
        } as unknown as Order,
      ],
      [], [], 'https://x', '', { limits: { orders: 300, quotes: 500 } },
    );

  it('design commun une fois, sélecteur de noms, badge et détail replié', () => {
    const html = page(items());
    // Hors détail replié : une seule vignette du dos (le détail en garde une par personne).
    const visible = html.split('<details class="grp-detail">')[0];
    expect(visible.split(`src="${DOS}"`).length - 1).toBe(1);
    expect(html).toContain('class="js-grp-select"');
    expect(html).toMatch(/<option value="[^"]*share_multi_AITO\.jpg">AITO · M<\/option>/);
    expect(html).toContain('⚠ 2 à vérifier');
    expect(html).toContain('Voir le détail ligne par ligne (3)');
    expect(html).toContain('Personnalisation manche'); // l'article hors groupe reste visible
  });

  it('une commande simple garde son affichage', () => {
    const html = page([{ title: 'T-shirt', quantity: 1, properties: [{ name: '_Logo cœur', value: COEUR }] }]);
    expect(html).not.toContain('class="js-grp-select"');
    expect(html).not.toContain('Voir le détail ligne par ligne');
  });
});
