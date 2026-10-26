import { dashboardPage, detailsRegroupes } from '../src/admin/admin.view';

/**
 * Devis multi-produits reçu avec UNE ligne par pièce (répartition par tailles) :
 * 66 vignettes identiques et 66 pastilles « 1× … — M ». L'affichage les
 * regroupe, sans toucher aux données enregistrées.
 */
const CAMEL = 'https://res.cloudinary.com/demo/image/upload/v1/camel.png';
const NOIR = 'https://res.cloudinary.com/demo/image/upload/v1/noir.png';

function devisParPiece() {
  const details = ['Commande sur devis : 2 famille(s), 67 ligne(s), 116 pièce(s).', '50× Coin métal — Type : Recto verso'];
  const previews: any[] = [{ label: 'Coin métal', base: 'https://res.cloudinary.com/demo/image/upload/v1/coin.png' }];
  for (let i = 0; i < 33; i++) {
    details.push('1× T-shirt coton — Couleur : Camel — M');
    previews.push({ label: 'T-shirt coton', base: CAMEL });
  }
  for (let i = 0; i < 33; i++) {
    details.push('1× T-shirt polyester — Couleur : Noir — M');
    previews.push({ label: 'T-shirt polyester', base: NOIR });
  }
  return {
    id: '22222222-2222-2222-2222-222222222222',
    createdAt: new Date(),
    quoteData: {
      customer: { nom: 'Client Test', email: 'c@test.fr' },
      coin: { name: 'Commande sur devis (68 articles)', qty: 116, details, previews },
    },
  } as any;
}

describe('devis : lignes identiques regroupées à l’affichage', () => {
  it('additionne les lignes identiques et garde le résumé en tête', () => {
    expect(
      detailsRegroupes([
        'Résumé',
        '1× T-shirt — Couleur : Camel — M',
        '2× T-shirt — Couleur : Camel — L',
        '1× T-shirt — Couleur : Camel — M',
      ]),
    ).toEqual(['Résumé', '2× T-shirt — Couleur : Camel — M', '2× T-shirt — Couleur : Camel — L']);
  });

  it('la carte montre 33× par article et une vignette par image, avec son nombre', () => {
    const html = dashboardPage([], [devisParPiece()], [], 'https://x', '', { limits: { orders: 300, quotes: 500 } });
    expect(html).toContain('33× T-shirt coton — Couleur : Camel — M');
    expect(html).toContain('33× T-shirt polyester — Couleur : Noir — M');
    expect(html).not.toContain('1× T-shirt coton');
    expect(html.split(`src="${CAMEL}"`).length - 1).toBe(1);
    expect(html.split(`src="${NOIR}"`).length - 1).toBe(1);
    expect(html).toContain('>×33<');
    expect(html).toContain('item item-devis');
  });
});
