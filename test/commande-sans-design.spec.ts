import { lignesSansDesign } from '../src/admin/admin.view';

/* #21695 : t-shirt polyester + 2 manches achetés depuis la page produit,
   hors configurateur — aucune propriété sur aucune ligne. */
const TSHIRT_POLY = '15982849130830';
const MANCHE = '15982845854030';

describe('lignesSansDesign', () => {
  it('signale les lignes du configurateur sans aucune propriété (#21695)', () => {
    const o = {
      shopifyOrderId: '7001',
      lineItems: [
        { title: 'Textile - T-shirt Polyester', productId: TSHIRT_POLY, properties: [] },
        { title: 'Personnalisation manche', productId: MANCHE },
      ],
    };
    expect(lignesSansDesign(o).map((l) => l.title)).toEqual([
      'Textile - T-shirt Polyester',
      'Personnalisation manche',
    ]);
  });

  it('ignore une commande normale du configurateur', () => {
    const o = {
      shopifyOrderId: '7002',
      lineItems: [
        { title: 'Textile - Sweatshirt', productId: '15982847033678', properties: [{ name: 'Taille', value: 'M' }] },
        { title: 'Personnalisation manche', productId: MANCHE, properties: [{ name: 'Article', value: 'Sweat' }] },
      ],
    };
    expect(lignesSansDesign(o)).toHaveLength(0);
  });

  it('ignore les autres produits de la boutique, les devis et les commandes manuelles', () => {
    const autre = { shopifyOrderId: '7003', lineItems: [{ title: 'Chaussettes', productId: '123', properties: [] }] };
    const devis = { shopifyOrderId: '7004', quoteId: 'q1', lineItems: [{ title: 'Patch personnalisé', productId: '15982850801998' }] };
    const manuelle = { shopifyOrderId: '-12', lineItems: [{ title: 'Textile - Sweatshirt', productId: '15982847033678' }] };
    expect(lignesSansDesign(autre)).toHaveLength(0);
    expect(lignesSansDesign(devis)).toHaveLength(0);
    expect(lignesSansDesign(manuelle)).toHaveLength(0);
  });

  it('reconnaît une ancienne commande par son titre (sans productId)', () => {
    const o = { shopifyOrderId: '7005', lineItems: [{ title: 'Drapeau personnalisé', properties: [] }] };
    expect(lignesSansDesign(o)).toHaveLength(1);
  });
});
