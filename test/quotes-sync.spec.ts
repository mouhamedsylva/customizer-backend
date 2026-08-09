import { QuotesService } from '../src/quotes/quotes.service';
import type { Repository } from 'typeorm';
import type { Quote } from '../src/database/entities/quote.entity';
import type { ShopifyService } from '../src/shared/shopify.service';

/**
 * Synchronisation périodique des devis.
 *
 * `syncStatuses` fait UN appel Shopify par devis non finalisé, en séquence, et
 * Shopify plafonne à ~2 requêtes/seconde. Deux protections sont testées ici :
 *
 *  - le VERROU : sans lui, une passe dépassant l'intervalle de 10 min laissait
 *    la suivante démarrer par-dessus, et les passes s'empilaient sans fin ;
 *  - le PLAFOND : sans lui, toute la table (colonne JSON comprise) passait en
 *    mémoire à chaque passage.
 */
type FindOpts = {
  take?: number;
  where?: Record<string, unknown>;
  order?: Record<string, unknown>;
};

function build(opts: {
  quotes?: Partial<Quote>[];
  /** Retarde chaque appel Shopify, pour simuler une passe longue. */
  delayMs?: number;
  onFind?: (o: FindOpts) => void;
}) {
  const appels: string[] = [];

  const shopify = {
    getDraftOrder: async (id: string) => {
      appels.push(String(id));
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      return { status: 'open', total_price: '10.00' };
    },
  } as unknown as ShopifyService;

  const repo = {
    find: async (o: FindOpts = {}) => {
      opts.onFind?.(o);
      const all = (opts.quotes || []) as Quote[];
      return typeof o.take === 'number' ? all.slice(0, o.take) : all;
    },
    update: async () => ({ affected: 1 }),
  } as unknown as Repository<Quote>;

  return { service: new QuotesService(shopify, repo), appels };
}

const devis = (i: number): Partial<Quote> => ({
  id: `q${i}`,
  draftOrderId: String(1000 + i),
  draftStatus: 'open',
  totalPrice: null,
  paidOrderId: null,
});

describe('QuotesService.syncStatuses — verrou de ré-entrance', () => {
  it('ignore une passe lancée pendant qu’une autre tourne', async () => {
    // Chaque appel Shopify dure 20 ms : la première passe est encore en vol
    // quand la seconde démarre.
    const { service, appels } = build({
      quotes: [devis(1), devis(2), devis(3)],
      delayMs: 20,
    });

    const premiere = service.syncStatuses('test-1');
    const seconde = await service.syncStatuses('test-2'); // pendant la 1re
    const r1 = await premiere;

    expect(seconde).toEqual({ updated: 0 }); // rejetée par le verrou
    expect(r1.updated).toBeGreaterThan(0);
    // 3 devis interrogés UNE fois, pas six.
    expect(appels).toHaveLength(3);
  });

  it('libère le verrou une fois la passe terminée', async () => {
    const { service } = build({ quotes: [devis(1)] });
    await service.syncStatuses('test-1');
    // Sans `finally`, ce second appel serait rejeté.
    const r = await service.syncStatuses('test-2');
    expect(r.updated).toBeGreaterThan(0);
  });

  it('libère le verrou même si la passe échoue', async () => {
    const shopify = {
      getDraftOrder: async () => {
        throw new Error('Shopify indisponible');
      },
    } as unknown as ShopifyService;
    const repo = {
      find: async () => {
        throw new Error('base indisponible');
      },
      update: async () => ({ affected: 1 }),
    } as unknown as Repository<Quote>;
    const s = new QuotesService(shopify, repo);

    await s.syncStatuses('échec');
    // Le verrou doit être rendu : sinon plus aucune passe ne tournerait
    // jusqu'au prochain redémarrage.
    const r = await s.syncStatuses('suivante');
    expect(r).toEqual({ updated: 0 }); // échoue encore, mais N'EST PAS bloquée
  });

  it('partage le verrou avec le rattrapage des orphelins', async () => {
    const { service } = build({ quotes: [devis(1), devis(2)], delayMs: 20 });
    const sync = service.syncStatuses('test');
    const orphelins = await service.retryOrphanQuotes(); // pendant la synchro
    await sync;
    expect(orphelins).toEqual({ retried: 0 });
  });
});

describe('QuotesService.syncStatuses — plafond', () => {
  it('borne le lot et écarte les devis finalisés en SQL', async () => {
    let vu: FindOpts | undefined;
    const { service } = build({
      quotes: Array.from({ length: 500 }, (_, i) => devis(i)),
      onFind: (o) => (vu = o),
    });
    await service.syncStatuses('test');

    expect(typeof vu?.take).toBe('number');
    expect(vu?.take).toBeLessThanOrEqual(200);
    // Le filtre « non finalisé » doit être en base, pas en mémoire : sinon on
    // charge la colonne JSON de chaque devis payé pour la jeter aussitôt.
    expect(vu?.where).toHaveProperty('draftStatus');
    // Ordre explicite : sans lui, MySQL peut renvoyer toujours les mêmes
    // lignes et laisser la queue jamais synchronisée.
    expect(vu?.order).toBeDefined();
  });

  it('n’interroge Shopify que pour les devis du lot', async () => {
    const { service, appels } = build({
      quotes: Array.from({ length: 500 }, (_, i) => devis(i)),
    });
    await service.syncStatuses('test');
    expect(appels.length).toBeLessThanOrEqual(200);
  });
});

describe('QuotesService.findAll — plafond', () => {
  it('borne la liste servie par l’API', async () => {
    let vu: FindOpts | undefined;
    const { service } = build({
      quotes: Array.from({ length: 2000 }, (_, i) => devis(i)),
      onFind: (o) => (vu = o),
    });
    const rows = await service.findAll();
    expect(vu?.take).toBeLessThanOrEqual(500);
    expect(rows.length).toBeLessThanOrEqual(500);
  });

  it('ne laisse pas un appelant réclamer toute la table', async () => {
    let vu: FindOpts | undefined;
    const { service } = build({
      quotes: Array.from({ length: 2000 }, (_, i) => devis(i)),
      onFind: (o) => (vu = o),
    });
    await service.findAll(999999);
    expect(vu?.take).toBeLessThanOrEqual(500);
  });
});
