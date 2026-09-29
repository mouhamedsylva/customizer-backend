import { WebhooksService } from '../src/webhooks/webhooks.service';

/**
 * Un devis n'est marqué payé que par la commande issue de SON brouillon.
 *
 * « Référence devis » est une propriété de ligne écrite par le client : une
 * commande quelconque (un patch à 3,50 €) portant l'UUID d'un devis le faisait
 * passer payé — relances arrêtées, atelier trompé.
 */
function monter(orderIdDuBrouillon: string | null) {
  const updates: Array<[string, Record<string, unknown>]> = [];
  const devis = { id: 'q-1', draftOrderId: '777', draftStatus: 'invoice_sent', paidOrderId: null };
  const quotes = {
    findOne: async () => devis,
    update: async (id: string, patch: Record<string, unknown>) => {
      updates.push([id, patch]);
    },
  };
  const shopify = {
    getDraftOrder: async () => ({ id: 777, order_id: orderIdDuBrouillon, total_price: '1750.00' }),
  };
  const s = new WebhooksService({ get: () => undefined } as any, shopify as any, {} as any, quotes as any);
  (s as any).logger = { log() {}, warn() {}, error() {}, debug() {} };
  return { s, updates };
}

describe('marquerDevisPaye', () => {
  it('refuse une commande étrangère portant l’UUID du devis', async () => {
    const { s, updates } = monter('999'); // le brouillon a produit la commande 999
    await (s as any).marquerDevisPaye('q-1', '123', { total_price: '3.50' });
    expect(updates).toHaveLength(0);
  });

  it('refuse tant que le brouillon n’a produit aucune commande', async () => {
    const { s, updates } = monter(null);
    await (s as any).marquerDevisPaye('q-1', '123', { total_price: '3.50' });
    expect(updates).toHaveLength(0);
  });

  it('accepte la commande issue du brouillon, au total du brouillon', async () => {
    const { s, updates } = monter('123');
    await (s as any).marquerDevisPaye('q-1', '123', { total_price: '3.50' });
    expect(updates).toEqual([
      ['q-1', { draftStatus: 'completed', paidOrderId: '123', totalPrice: '1750.00' }],
    ]);
  });
});
