import type { ConfigService } from '@nestjs/config';
import { articlesDuDevis } from '../src/quotes/articles-devis';
import { ShopifyService } from '../src/shared/shopify.service';
import { dashboardPage } from '../src/admin/admin.view';
import type { Quote } from '../src/database/entities/quote.entity';

/**
 * Chiffrage PAR ARTICLE des devis multi-articles.
 *
 * Cas réel : devis de Guillermain, 22 septembre 2026 — antérieur aux
 * « familles », donc chiffré jusque-là par un prix unique pour 70 pièces
 * mêlant patchs et coins.
 */
const GUILLERMAIN = {
  customer: { nom: 'Guillermain', email: 'client@exemple.fr' },
  coin: {
    name: 'Commande sur devis (3 articles)',
    qty: 70,
    details: [
      'Commande sur devis : 2 famille(s), 3 ligne(s), 70 pièce(s).',
      '10× Patch personnalisé — Face : Une seule face (sublimé) · Taille : 8 cm · Format : Rond · Type : Sublimé',
      '10× Patch personnalisé — Face : Une seule face (sublimé) · Taille : 8 cm · Format : Rond · Type : Sublimé',
      '50× Coin métal — Type : Recto verso · Forme : Rond · Taille : 30 mm · Finition : À choisir',
    ],
    previews: [],
  },
};

describe('articlesDuDevis', () => {
  it('lit les trois articles du devis réel, résumé exclu', () => {
    const a = articlesDuDevis(GUILLERMAIN)!;
    expect(a.map((x) => [x.libelle, x.qty])).toEqual([
      ['Patch personnalisé', 10],
      ['Patch personnalisé', 10],
      ['Coin métal', 50],
    ]);
    expect(a[2].options).toBe('Type : Recto verso · Forme : Rond · Taille : 30 mm · Finition : À choisir');
  });

  it('refuse un découpage dont la somme ne retombe pas sur la quantité', () => {
    expect(articlesDuDevis({ coin: { ...GUILLERMAIN.coin, qty: 71 } })).toBeNull();
  });

  it('laisse les devis à un article et les commandes de groupe à leur mode', () => {
    expect(articlesDuDevis({ coin: { name: 'Coin', qty: 50, details: ['50× Coin métal — Rond'] } })).toBeNull();
    expect(articlesDuDevis({ ...GUILLERMAIN, group: { rows: [{ size: 'M', color: 'Noir', qty: 1 }] } })).toBeNull();
  });

  it('se replie sur les lignes des familles', () => {
    const devis = {
      coin: {
        qty: 30,
        details: ['texte libre'],
        familles: [
          { cle: 'patch', libelle: 'Patchs', qty: 20, lignes: ['20× Patch — Rond'] },
          { cle: 'coin', libelle: 'Coins', qty: 10, lignes: ['10× Coin — Carré'] },
        ],
      },
    };
    expect(articlesDuDevis(devis)!.map((x) => x.qty)).toEqual([20, 10]);
  });
});

describe('ShopifyService.setDraftOrderArticles', () => {
  function build(lineItems: Array<Record<string, unknown>>) {
    const envoye: { items?: Array<Record<string, any>> } = {};
    const config = { get: () => 'x' } as unknown as ConfigService;
    const s = new ShopifyService(config);
    (s as any).getDraftOrder = async () => ({ line_items: lineItems });
    (s as any).updateDraftOrderLineItems = async (_id: string, items: Array<Record<string, any>>) => {
      envoye.items = items;
      return { total_price: '0' };
    };
    return { service: s, envoye };
  }

  it('remplace la ligne unique par une ligne par article, chacune à son prix', async () => {
    const { service, envoye } = build([
      {
        title: 'Commande sur devis (3 articles)',
        quantity: 70,
        taxable: true,
        requires_shipping: true,
        properties: [
          { name: 'Référence devis', value: 'Q-1' },
          { name: 'Aperçu 1', value: 'https://res.cloudinary.com/x.png' },
        ],
      },
    ]);
    const articles = articlesDuDevis(GUILLERMAIN)!;
    await service.setDraftOrderArticles(1, articles, [4.2, 3.9, 12]);

    const l = envoye.items!;
    expect(l.map((x) => [x.title, x.quantity, x.price])).toEqual([
      ['Patch personnalisé', 10, '4.20'],
      ['Patch personnalisé', 10, '3.90'], // deux articles identiques, deux prix
      ['Coin métal', 50, '12.00'],
    ]);
    expect(l.every((x) => x.custom && x.taxable && x.requires_shipping)).toBe(true);
    // Référence sur chaque ligne ; aperçus sur la première seulement.
    expect(l.every((x) => x.properties.some((p: any) => p.name === 'Référence devis'))).toBe(true);
    expect(l[0].properties.some((p: any) => p.name === 'Aperçu 1')).toBe(true);
    expect(l[1].properties.some((p: any) => p.name === 'Aperçu 1')).toBe(false);
    expect(l[2].properties).toContainEqual({ name: 'Options', value: articles[2].options });
  });

  it('refuse un nombre de prix différent du nombre d’articles', async () => {
    const { service } = build([{ title: 'x', quantity: 1, properties: [] }]);
    await expect(service.setDraftOrderArticles(1, articlesDuDevis(GUILLERMAIN)!, [1, 2])).rejects.toThrow();
  });
});

describe('dashboard — bouton de chiffrage', () => {
  it('porte la liste des articles pour la fenêtre', () => {
    const html = dashboardPage(
      [],
      [
        {
          id: 'q-1',
          draftOrderId: '1577212870990',
          draftStatus: 'open',
          quoteData: GUILLERMAIN,
          createdAt: new Date(),
        } as unknown as Quote,
      ],
      [],
      'https://exemple.fr',
      'boutique',
      { limits: { orders: 300, quotes: 500 } },
    );
    const m = html.match(/data-articles="([^"]*)"/);
    expect(m).not.toBeNull();
    const articles = JSON.parse(m![1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
    expect(articles).toHaveLength(3);
  });
});
