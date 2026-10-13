import { documentsDuDevis } from '../src/quotes/pieces-jointes';
import { dashboardPage, productionSheetPage } from '../src/admin/admin.view';

const BAT = 'https://res.cloudinary.com/c/raw/upload/v1/customizer/temp-attachments/BAT_1.pdf';
const MAQ = 'https://res.cloudinary.com/c/image/upload/v1/customizer/temp-attachments/maquette_1.png';

const devis = (pieces: unknown) =>
  ({ id: '11111111-1111-1111-1111-111111111111', paidOrderId: '42', tempAttachments: pieces, quoteData: {} }) as any;

const commande = () =>
  ({
    shopifyOrderId: '42', orderNumber: '#20500', quoteId: '11111111-1111-1111-1111-111111111111',
    lineItems: [{ title: 'Patchs personnalisés', quantity: 50, properties: [] }],
    productionStatus: 'to_produce', totalPrice: '250.00', receivedAt: new Date(),
  }) as any;

describe('documentsDuDevis', () => {
  it('distingue PDF et images, écarte les URL hors Cloudinary', () => {
    expect(
      documentsDuDevis(
        devis([
          { name: 'BAT signé.pdf', url: BAT, type: 'application/pdf' },
          { name: 'Maquette.png', url: MAQ, type: 'image/png' },
          { name: 'Pirate', url: 'https://evil.com/x.pdf' },
        ]),
      ),
    ).toEqual([
      { name: 'BAT signé.pdf', url: BAT, estImage: false },
      { name: 'Maquette.png', url: MAQ, estImage: true },
    ]);
    expect(documentsDuDevis(null)).toEqual([]);
    expect(documentsDuDevis(devis(null))).toEqual([]);
  });
});

describe('BAT du devis sur la commande', () => {
  const q = devis([{ name: 'BAT signé.pdf', url: BAT, type: 'application/pdf' }]);

  it('apparaît sur la carte de la commande du dashboard', () => {
    const html = dashboardPage([commande()], [], [], 'https://x', '', { allQuotes: [q] });
    expect(html).toContain('Documents du devis (BAT…)');
    expect(html).toContain(BAT);
  });

  it('apparaît sur la fiche de production', () => {
    const html = productionSheetPage(commande(), '', q);
    expect(html).toContain('Documents du devis (BAT…)');
    expect(html).toContain('BAT signé.pdf');
  });

  it('aucun bloc sans document', () => {
    expect(productionSheetPage(commande(), '', devis(null))).not.toContain('Documents du devis');
  });
});
