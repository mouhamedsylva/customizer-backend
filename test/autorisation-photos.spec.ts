import { autorisationPhotos } from '../src/shared/autorisation-photos';
import { dashboardPage, productionSheetPage } from '../src/admin/admin.view';
import type { Order } from '../src/database/entities/order.entity';

/** Autorisation de publier les photos : attribut de panier → carte et fiche. */
describe('autorisation photos réseaux sociaux', () => {
  it('lit la réponse dans les note_attributes', () => {
    expect(autorisationPhotos([{ name: 'Autorisation photos réseaux sociaux', value: 'Oui' }])).toBe('oui');
    expect(autorisationPhotos([{ name: 'autorisation photos reseaux sociaux', value: 'Non' }])).toBe('non');
    expect(autorisationPhotos([{ name: 'Autre', value: 'Oui' }])).toBeNull();
    expect(autorisationPhotos(undefined)).toBeNull();
  });

  const commande = (photos?: string) =>
    ({
      shopifyOrderId: '1', orderNumber: '#1', totalPrice: '30', lineItems: [{ title: 'T-shirt', quantity: 1, properties: [] }],
      customerName: 'Client', customerInfo: photos ? { photos } : {},
      productionStatus: 'to_produce', financialStatus: 'paid', receivedAt: new Date(), shopifyCreatedAt: new Date(),
    }) as unknown as Order;
  const carte = (o: Order) => dashboardPage([o], [], [], 'https://x', '', { limits: { orders: 300, quotes: 500 } });

  it('carte : pastille et mention selon la réponse', () => {
    expect(carte(commande('oui'))).toContain('📷 Photos : OK');
    expect(carte(commande('oui'))).toContain('Oui, autorisé');
    expect(carte(commande('non'))).toContain('📷 Pas de photos');
    expect(carte(commande('non'))).toContain('Non, refusé');
    const sans = carte(commande());
    expect(sans).not.toContain('📷 Photos : OK');
    expect(sans).toContain('Non renseigné');
  });

  it('fiche de production : la mention est imprimée', () => {
    expect(productionSheetPage(commande('oui'))).toContain('Photos réseaux sociaux');
    expect(productionSheetPage(commande('oui'))).toContain('Oui, autorisé');
    expect(productionSheetPage(commande('non'))).toContain('Non, refusé');
  });
});
