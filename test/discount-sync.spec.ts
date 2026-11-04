import {
  calculerRemises,
  planifier,
  TITLE_PREFIX,
  DiscountSyncService,
} from '../src/admin/discount-sync.service';
import type { AutomaticDiscount } from '../src/shared/shopify.service';
import type { Tiers } from '../src/admin/pricing.service';

const TSHIRT = '15982848246094';
const PATCH = '15982850801998';

const TIERS: Tiers = {
  tshirt: [
    { min: 50, price: 24.5 },
    { min: 20, price: 25.9 },
    { min: 10, price: 26.5 },
    { min: 5, price: 28.9 },
    { min: 1, price: 32 },
  ],
  patches: [
    { min: 100, price: 3.5 },
    { min: 50, price: 5 },
    { min: 30, price: 9 },
    { min: 20, price: 12.5 },
    { min: 10, price: 20 },
  ],
  coins: [{ min: 10, price: 1 }],
};

function existante(p: Partial<AutomaticDiscount>): AutomaticDiscount {
  return {
    id: 'gid://shopify/DiscountAutomaticNode/1',
    type: 'DiscountAutomaticBasic',
    title: `${TITLE_PREFIX}T-shirt coton (10+)`,
    status: 'ACTIVE',
    minQuantity: 10,
    amount: 5.5,
    appliesOnEachItem: true,
    productIds: [TSHIRT],
    ...p,
  };
}

describe('calculerRemises', () => {
  const r = calculerRemises(TIERS, { tshirt: 32, patches: 20 });

  it('montant = prix du variant − prix du palier, au centime', () => {
    const t = r.filter((x) => x.key === 'tshirt').map((x) => [x.min, x.amount]);
    expect(t).toEqual([[50, 7.5], [20, 6.1], [10, 5.5], [5, 3.1]]);
  });

  it('ignore le palier de base (min 1, ou prix ≥ prix du variant)', () => {
    expect(r.some((x) => x.min === 1)).toBe(false);
    // Patch : le palier 10 vaut le prix du variant (20) -> pas de remise.
    expect(r.filter((x) => x.key === 'patches').map((x) => x.min)).toEqual([100, 50, 30, 20]);
  });

  it('cible le bon produit, titre stable et lisible', () => {
    const p = r.find((x) => x.key === 'patches' && x.min === 20)!;
    expect(p.productId).toBe(PATCH);
    expect(p.amount).toBe(7.5);
    expect(p.title).toBe(`${TITLE_PREFIX}Patch (20+)`);
  });

  it('aucune remise pour les coins (sur devis) ni sans prix lu', () => {
    expect(r.some((x) => x.key === 'coins')).toBe(false);
    expect(calculerRemises(TIERS, { patches: 20 }).some((x) => x.key === 'tshirt')).toBe(false);
  });
});

describe('planifier', () => {
  const voulues = calculerRemises({ tshirt: TIERS.tshirt }, { tshirt: 32 });

  it('crée tout sur une boutique vierge, sans toucher aux remises manuelles', () => {
    const manuelle = existante({ id: 'm', title: 'Soldes été', productIds: [TSHIRT] });
    const p = planifier(voulues, [manuelle]);
    expect(p.creer).toHaveLength(4);
    expect(p.supprimer).toHaveLength(0);
  });

  it('laisse intacte une remise à jour, modifie une remise au mauvais montant', () => {
    const p = planifier(voulues, [
      existante({}),
      existante({ id: 'b', title: `${TITLE_PREFIX}T-shirt coton (5+)`, minQuantity: 5, amount: 0.6 }),
    ]);
    expect(p.inchangees).toBe(1);
    expect(p.modifier.map((m) => [m.id, m.remise.amount])).toEqual([['b', 3.1]]);
    expect(p.creer.map((x) => x.min)).toEqual([50, 20]);
  });

  it('réactive une remise expirée', () => {
    const p = planifier(voulues, [existante({ status: 'EXPIRED' })]);
    expect(p.modifier.map((m) => m.id)).toEqual(['gid://shopify/DiscountAutomaticNode/1']);
  });

  it('supprime un palier retiré de la grille', () => {
    const p = planifier(voulues, [existante({ id: 'x', title: `${TITLE_PREFIX}T-shirt coton (15+)`, minQuantity: 15 })]);
    expect(p.supprimer.map((d) => d.id)).toEqual(['x']);
  });

  it('conserve les remises d\'un produit dont le prix n\'a pas pu être lu', () => {
    const patch = existante({ id: 'p', title: `${TITLE_PREFIX}Patch (20+)`, productIds: [PATCH] });
    expect(planifier(voulues, [patch], [PATCH]).supprimer).toHaveLength(0);
    expect(planifier(voulues, [patch]).supprimer.map((d) => d.id)).toEqual(['p']);
  });

  it('remplace une remise qui cible le mauvais produit, et supprime les doublons', () => {
    const p = planifier(voulues, [
      existante({ id: 'a', productIds: [PATCH] }),
      existante({ id: 'dup' }),
    ]);
    expect(p.supprimer.map((d) => d.id).sort()).toEqual(['a', 'dup']);
    expect(p.creer.some((x) => x.min === 10)).toBe(true);
  });
});

describe('DiscountSyncService.synchroniser', () => {
  function build(listOk = true) {
    const shopify = {
      getProductPrice: jest.fn(async (id: string) =>
        id === TSHIRT ? { ok: true, price: 32 } : { ok: false, error: 'introuvable' }),
      listAutomaticDiscounts: jest.fn(async () =>
        listOk ? { ok: true, discounts: [existante({})] } : { ok: false, error: 'Access denied' }),
      createTierDiscount: jest.fn(async () => ({ ok: true })),
      updateTierDiscount: jest.fn(async () => ({ ok: true })),
      deleteAutomaticDiscount: jest.fn(async () => ({ ok: true })),
    };
    const pricing = { getTiers: jest.fn(async () => ({ tshirt: TIERS.tshirt })) };
    return { svc: new DiscountSyncService(pricing as any, shopify as any), shopify };
  }

  it('applique le plan et remonte les produits illisibles en avertissement', async () => {
    const { svc, shopify } = build();
    const r = await svc.synchroniser();
    expect(r.creees).toBe(3);
    expect(r.inchangees).toBe(1);
    expect(shopify.deleteAutomaticDiscount).not.toHaveBeenCalled();
    expect(r.avertissements.some((a) => a.includes('Sweatshirt'))).toBe(true);
  });

  it('ne touche à rien si la lecture des remises échoue (permissions)', async () => {
    const { svc, shopify } = build(false);
    const r = await svc.synchroniser();
    expect(r.ok).toBe(false);
    expect(r.avertissements.join(' ')).toContain('write_discounts');
    expect(shopify.createTierDiscount).not.toHaveBeenCalled();
  });
});
