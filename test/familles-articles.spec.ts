import { familleDeLigne, famillesDeCommande } from '../src/admin/familles-articles';
import { dashboardPage } from '../src/admin/admin.view';

describe('familleDeLigne : titres réels des commandes', () => {
  it.each([
    ['Textile - Sweatshirt', 'textiles'],
    ['Textile - T-shirt Coton', 'textiles'],
    ['Textile - T-shirt Polyester', 'textiles'],
    ['Personnalisation manche', 'textiles'],
    ['Textile — M / Noir', 'textiles'],
    ['Sweatshirts personnalisés', 'textiles'],
    ['T-shirts personnalisés', 'textiles'],
    ['Patch personnalisé', 'patchs'],
    ['Patch personnalisé (PVC)', 'patchs'],
    ['Patchs personnalisés', 'patchs'],
    ['Commande de patchs (30 pièces)', 'patchs'],
    ['Coin métal personnalisé', 'coins'],
    ['Coins métal personnalisés', 'coins'],
    ['Drapeau personnalisé', 'drapeaux'],
    ['Drapeaux personnalisés', 'drapeaux'],
  ])('%s → %s', (titre, attendu) => {
    expect(familleDeLigne(titre)).toBe(attendu);
  });

  it('ne reconnaît pas un titre sans rapport', () => {
    expect(familleDeLigne('Chaussettes Massacre')).toBeNull();
    expect(familleDeLigne(undefined)).toBeNull();
  });
});

describe('famillesDeCommande', () => {
  it('liste chaque famille une fois, dans l’ordre du filtre', () => {
    expect(
      famillesDeCommande([
        { title: 'Textile - Sweatshirt' },
        { title: 'Patch personnalisé' },
        { title: 'Personnalisation manche' },
      ]),
    ).toEqual(['patchs', 'textiles']);
  });

  it('commande sans famille reconnue : autre', () => {
    expect(famillesDeCommande([{ title: 'Commande sur devis (3 articles)' }])).toEqual(['autre']);
    expect(famillesDeCommande(null)).toEqual(['autre']);
  });
});

describe('dashboard : menu « par article »', () => {
  it('affiche le menu avec ses compteurs et marque chaque carte', () => {
    const commande = (id: string, titre: string) =>
      ({
        shopifyOrderId: id, orderNumber: '#' + id, lineItems: [{ title: titre, quantity: 1, properties: [] }],
        productionStatus: 'to_produce', totalPrice: '10.00', receivedAt: new Date(),
      }) as any;
    const html = dashboardPage(
      [commande('1', 'Patch personnalisé'), commande('2', 'Textile - Sweatshirt')],
      [], [], 'https://x', '',
    );
    expect(html).toContain('Tous les articles (2)');
    expect(html).toContain('Patchs (1)');
    expect(html).toContain('Textiles (1)');
    expect(html).toContain('data-articles="patchs"');
    expect(html).toContain('data-onpick="filterArticles"');
  });
});

describe('dashboard : retour visuel des filtres', () => {
  it('embarque l’animation des filtres et le chargement du filtre de période', () => {
    const html = dashboardPage(
      [{ shopifyOrderId: '1', orderNumber: '#1', lineItems: [{ title: 'Patch personnalisé', quantity: 1, properties: [] }], productionStatus: 'to_produce', totalPrice: '1', receivedAt: new Date() } as any],
      [], [], 'https://x', '',
    );
    expect(html).toContain('function signalerFiltre(dd)');
    expect(html).toContain('.dd.f-pulse');
    expect(html).toContain("dd.classList.add('f-loading')");
  });
});
