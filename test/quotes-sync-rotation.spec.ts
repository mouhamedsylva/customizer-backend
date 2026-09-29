import { IsNull } from 'typeorm';
import { QuotesService } from '../src/quotes/quotes.service';

/**
 * Synchro des devis : les nouveaux devis (statut NULL) sont pris en compte, et
 * les lots TOURNENT au lieu de reprendre toujours les 200 plus anciens.
 */
function monter(nbDevis: number) {
  const tous = Array.from({ length: nbDevis }, (_, i) => ({
    id: `q${i}`,
    draftOrderId: String(1000 + i),
    draftStatus: null,
    createdAt: new Date(2026, 0, 1, 0, 0, i),
  }));
  const appels: any[] = [];
  const repo = {
    find: async (opts: any) => {
      appels.push(opts);
      const where = Array.isArray(opts.where) ? opts.where[0] : opts.where;
      const apres: Date | undefined = where?.createdAt?._value;
      return tous.filter((q) => !apres || q.createdAt > apres).slice(0, opts.take);
    },
    update: async () => ({}),
  };
  const shopify = { getDraftOrder: async () => ({ status: 'open' }) };
  const s = new QuotesService(shopify as any, repo as any);
  (s as any).logger = { log() {}, warn() {}, error() {}, debug() {} };
  return { s, appels };
}

describe('QuotesService.syncStatuses', () => {
  it('sélectionne aussi les devis sans statut (tout juste créés)', async () => {
    const { s, appels } = monter(3);
    await s.syncStatuses('test');
    const where = appels[0].where;
    expect(Array.isArray(where)).toBe(true);
    expect(where.some((w: any) => w.draftStatus && w.draftStatus._type === IsNull()._type)).toBe(true);
  });

  it('fait tourner les lots : la 2e passe reprend après la 1re, puis repart du début', async () => {
    const { s, appels } = monter(250); // lot plafonné à 200
    await s.syncStatuses('p1');
    await s.syncStatuses('p2');
    await s.syncStatuses('p3');
    const debut = (i: number) => appels[i].where[0].createdAt;
    expect(debut(0)).toBeUndefined();                  // passe 1 : depuis le début
    expect(debut(1)?._value).toEqual(new Date(2026, 0, 1, 0, 0, 199)); // passe 2 : après le 200e
    expect(debut(2)).toBeUndefined();                  // passe 3 : lot incomplet → retour au début
  });
});
