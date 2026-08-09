import { PricingService } from '../src/admin/pricing.service';
import type { Repository } from 'typeorm';
import type { Setting } from '../src/database/entities/setting.entity';

/**
 * Grilles tarifaires servies au configurateur.
 *
 * Ces valeurs sont affichées au client et répercutées sur les variants
 * Shopify : une grille mal normalisée se traduit directement en prix erroné.
 */
function build(rows: Array<{ key: string; value: string }> = []): PricingService {
  const store = new Map(rows.map((r) => [r.key, r.value]));
  const repo = {
    find: async () => [...store].map(([key, value]) => ({ key, value })),
    save: async (x: unknown) => {
      const list = Array.isArray(x) ? x : [x];
      for (const r of list as Array<{ key: string; value: string }>) {
        store.set(r.key, r.value);
      }
      return x;
    },
    manager: {
      transaction: async (cb: (trx: unknown) => Promise<unknown>) =>
        cb({ getRepository: () => ({ save: repo.save }) }),
    },
  } as unknown as Repository<Setting> & { save: (x: unknown) => Promise<unknown> };
  return new PricingService(repo);
}

describe('PricingService.save', () => {
  it('arrondit au centime et ignore les valeurs invalides', async () => {
    const s = build();
    const prices = await s.save({
      tshirt: 24.999,
      sweatshirt: -5, // négatif : ignoré
      patches: 'abc' as unknown as number, // non numérique : ignoré
    });
    expect(prices.tshirt).toBe(25);
    expect(prices.sweatshirt).toBe(60); // valeur par défaut conservée
    expect(prices.patches).toBe(20);
  });

  it('accepte un enregistrement partiel sans toucher aux autres produits', async () => {
    const s = build();
    const avant = await s.get();
    const apres = await s.save({ patches: 3.5 });
    expect(apres.patches).toBe(3.5);
    expect(apres.drapeaux).toBe(avant.drapeaux);
  });

  it('refuse le prix d’un produit vendu sur devis (coins)', async () => {
    // Les coins sont chiffrés à la main : un prix enregistré s'afficherait
    // dans le configurateur sans qu'aucune commande ne puisse l'honorer.
    const s = build();
    const avant = await s.get();
    const apres = await s.save({ coins: 3.5 });
    expect(apres.coins).toBe(avant.coins);
  });
});

describe('PricingService.saveTiers', () => {
  it('trie par seuil décroissant — l’ordre attendu par le configurateur', async () => {
    const s = build();
    const tiers = await s.saveTiers({
      tshirt: [
        { min: 10, price: 26.5 },
        { min: 50, price: 24.5 },
        { min: 1, price: 29.5 },
      ],
    });
    expect(tiers.tshirt!.map((t) => t.min)).toEqual([50, 10, 1]);
  });

  it('fusionne les doublons de seuil (le dernier gagne)', async () => {
    const s = build();
    const tiers = await s.saveTiers({
      tshirt: [
        { min: 10, price: 26.5 },
        { min: 10, price: 25.0 },
      ],
    });
    expect(tiers.tshirt).toEqual([{ min: 10, price: 25 }]);
  });

  it('écarte les paliers invalides sans casser la grille', async () => {
    const s = build();
    const tiers = await s.saveTiers({
      tshirt: [
        { min: 0, price: 10 }, // seuil < 1
        { min: 5, price: -2 }, // prix négatif
        { min: 2.7, price: 20 }, // seuil décimal -> tronqué à 2
        { min: 10, price: 26.5 },
      ],
    });
    expect(tiers.tshirt).toEqual([
      { min: 10, price: 26.5 },
      { min: 2, price: 20 },
    ]);
  });

  it('refuse AUSSI la grille d’un produit sur devis (coins)', async () => {
    // `save()` excluait les coins mais pas `saveTiers()` : le prix de base
    // était rejeté pendant que la grille, elle, s'enregistrait. Le
    // configurateur servait alors un prix par défaut contredit par sa propre
    // grille — et comme la ligne existait en base, l'état ne se réparait
    // jamais. C'est le scénario que ce test interdit.
    const s = build();
    const tiers = await s.saveTiers({ coins: [{ min: 10, price: 3 }] });
    expect(tiers.coins).toBeUndefined();
  });

  it('n’enregistre pas la grille des coins même mêlée à des produits valides', async () => {
    const s = build();
    const tiers = await s.saveTiers({
      coins: [{ min: 10, price: 3 }],
      tshirt: [{ min: 10, price: 26.5 }],
    });
    expect(tiers.coins).toBeUndefined();
    expect(tiers.tshirt).toEqual([{ min: 10, price: 26.5 }]);
  });

  it('distingue « grille vide » de « jamais configurée »', async () => {
    const s = build();
    // Une grille explicitement vide désactive la dégressivité — elle ne doit
    // PAS retomber sur la grille par défaut.
    const tiers = await s.saveTiers({ tshirt: [] });
    expect(tiers.tshirt).toEqual([]);
  });

  it('tolère une grille corrompue en base sans faire tomber la lecture', async () => {
    const s = build([{ key: 'tiers_tshirt', value: '{ ceci n est pas du JSON' }]);
    const tiers = await s.getTiers();
    expect(tiers.tshirt).toEqual([]);
  });
});
