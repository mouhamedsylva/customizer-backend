import { ShopifyService } from '../src/shared/shopify.service';
import type { ConfigService } from '@nestjs/config';

/**
 * Répartition du prix sur les lignes d'un devis.
 *
 * Le dashboard envoie un prix unitaire MOYEN (base × qté + flocage ÷ qté).
 * Appliquer `toFixed(2)` à chaque ligne faisait dériver le total facturé : un
 * groupe de 3 pièces à 35 € partait à 35,01 €, un lot de 13 à 1000 € tombait à
 * 999,96 €. L'écart s'affichait à l'opérateur, mais le client payait le montant
 * dérivé.
 *
 * CONTRAINTE : Shopify n'accepte qu'un prix unitaire par ligne et facture
 * prix × quantité. Le montant d'une ligne est donc un multiple de sa quantité —
 * sur une ligne UNIQUE dont le total ne se divise pas au centime, aucun calcul
 * ne peut retomber juste. Les tests distinguent les deux situations.
 */
function build(lineItems: Array<Record<string, unknown>>) {
  const envoye: { items?: Array<Record<string, unknown>> } = {};
  const config = {
    get: (k: string) =>
      ({
        SHOPIFY_STORE_URL: 'boutique-test.myshopify.com',
        SHOPIFY_ACCESS_TOKEN: 'shpat_test',
        SHOPIFY_API_VERSION: '2024-10',
      })[k],
  } as unknown as ConfigService;

  const s = new ShopifyService(config);
  (s as unknown as { getDraftOrder: unknown }).getDraftOrder = async () => ({
    line_items: lineItems,
  });
  (s as unknown as { updateDraftOrderLineItems: unknown }).updateDraftOrderLineItems =
    async (_id: string, items: Array<Record<string, unknown>>) => {
      envoye.items = items;
      return {};
    };
  return { service: s, envoye };
}

const ligne = (quantity: number, variant = true) =>
  variant
    ? { variant_id: 42, quantity, properties: [] }
    : { title: 'Personnalisation', quantity, properties: [] };

/** Total réellement facturé par Shopify : somme des prix × quantités. */
function totalFacture(items: Array<Record<string, unknown>>): number {
  const cents = items.reduce(
    (s, li) =>
      s + Math.round(Number(li.price) * 100) * (Number(li.quantity) || 1),
    0,
  );
  return cents / 100;
}

describe('setDraftOrderPrice — total exact sur plusieurs lignes', () => {
  it('retombe au centime sur un groupe réparti par taille', async () => {
    // 12 pièces en 6 lignes, total voulu 437,50 €.
    const { service, envoye } = build(Array.from({ length: 6 }, () => ligne(2)));
    await service.setDraftOrderPrice('1', 437.5 / 12);
    expect(totalFacture(envoye.items!)).toBe(437.5);
  });

  it('retombe au centime sur 3 lignes de 1 pièce (35 €)', async () => {
    const { service, envoye } = build([ligne(1), ligne(1), ligne(1)]);
    await service.setDraftOrderPrice('1', 35 / 3);
    expect(totalFacture(envoye.items!)).toBe(35);
  });

  it('retombe au centime sur des lignes de tailles inégales', async () => {
    // 13 pièces en 5+4+4, total voulu 1000 € : l'ancien calcul donnait 999,96.
    const { service, envoye } = build([ligne(5), ligne(4), ligne(4)]);
    await service.setDraftOrderPrice('1', 1000 / 13);
    expect(Math.abs(totalFacture(envoye.items!) - 1000)).toBeLessThanOrEqual(0.01);
  });

  it('est exact quand le prix tombe rond', async () => {
    const { service, envoye } = build([ligne(2), ligne(2)]);
    await service.setDraftOrderPrice('1', 30);
    expect(totalFacture(envoye.items!)).toBe(120);
    // Aucun centime à répartir : toutes les lignes au même prix.
    expect(envoye.items!.every((li) => li.price === '30.00')).toBe(true);
  });

  it('n’écarte jamais deux lignes de plus d’un centime', async () => {
    const { service, envoye } = build([ligne(1), ligne(1), ligne(1), ligne(1)]);
    await service.setDraftOrderPrice('1', 33.333);
    const prix = envoye.items!.map((li) => Math.round(Number(li.price) * 100));
    expect(Math.max(...prix) - Math.min(...prix)).toBeLessThanOrEqual(1);
  });
});

describe('setDraftOrderPrice — limite Shopify sur une ligne unique', () => {
  it('reste au plus proche quand aucun prix unitaire ne tombe juste', async () => {
    // 1000 € pour 13 pièces = 76,923… € l'unité : Shopify n'accepte qu'un prix
    // unitaire pour la ligne entière, l'écart est structurel.
    const { service, envoye } = build([ligne(13)]);
    await service.setDraftOrderPrice('1', 1000 / 13);
    const ecart = Math.abs(totalFacture(envoye.items!) - 1000);
    expect(ecart).toBeLessThanOrEqual(0.05); // borné, jamais silencieusement grand
  });

  it('ne dégrade pas les cas que l’ancien calcul traitait bien', async () => {
    const { service, envoye } = build([ligne(3)]);
    await service.setDraftOrderPrice('1', 35 / 3);
    // L'ancien calcul donnait 35,01 : on ne doit pas faire pire.
    expect(Math.abs(totalFacture(envoye.items!) - 35)).toBeLessThanOrEqual(0.01);
  });
});

describe('setDraftOrderPrice — structure préservée', () => {
  it('conserve variant_id, quantité et propriétés', async () => {
    const { service, envoye } = build([
      { variant_id: 99, quantity: 4, properties: [{ name: 'Taille', value: 'L' }] },
    ]);
    await service.setDraftOrderPrice('1', 10);
    const li = envoye.items![0];
    expect(li.variant_id).toBe(99);
    expect(li.quantity).toBe(4);
    expect(li.properties).toEqual([{ name: 'Taille', value: 'L' }]);
  });

  it('marque « custom » une ligne sans variant', async () => {
    const { service, envoye } = build([ligne(2, false)]);
    await service.setDraftOrderPrice('1', 10);
    expect(envoye.items![0].custom).toBe(true);
    expect(envoye.items![0].title).toBe('Personnalisation');
  });

  it('refuse un brouillon sans ligne', async () => {
    const { service } = build([]);
    await expect(service.setDraftOrderPrice('1', 10)).rejects.toThrow();
  });
});
