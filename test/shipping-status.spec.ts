import { fromShopify, toShopify } from '../src/shared/shipping-status';
import type { ProductionStatus } from '../src/shared/shipping-status';

/**
 * Machine à états du suivi de production.
 *
 * Deux vocabulaires qui ne se recouvrent pas : « Prête » n'existe pas chez
 * Shopify. La règle centrale est de NE JAMAIS RÉGRESSER — une commande marquée
 * prête en atelier ne doit pas revenir « en production » simplement parce que
 * Shopify, lui, ne distingue pas les deux.
 */
describe('fromShopify', () => {
  it('ne rétrograde pas une étape que Shopify ne sait pas exprimer', () => {
    // Shopify ignore « ready » : son `in_progress` ne contredit pas l'atelier.
    expect(fromShopify('in_progress', 'ready')).toBeNull();
    expect(fromShopify('in_progress', 'shipped')).toBeNull();
    expect(fromShopify('unfulfilled', 'ready')).toBeNull();
    expect(fromShopify('unfulfilled', 'producing')).toBeNull();
  });

  it('fait progresser le suivi quand Shopify est en avance', () => {
    expect(fromShopify('fulfilled', 'to_produce')).toBe('shipped');
    expect(fromShopify('in_progress', 'to_produce')).toBe('producing');
  });

  it('est idempotent : un état déjà atteint ne réécrit rien', () => {
    expect(fromShopify('fulfilled', 'shipped')).toBeNull();
    expect(fromShopify('in_progress', 'producing')).toBeNull();
  });

  it('ne traite « partial » que comme ambigu (l’atelier tranche)', () => {
    const etats: ProductionStatus[] = [
      'to_produce',
      'producing',
      'ready',
      'shipped',
    ];
    for (const e of etats) expect(fromShopify('partial', e)).toBeNull();
  });

  it('accepte la seule régression légitime : une expédition annulée', () => {
    expect(fromShopify('unfulfilled', 'shipped')).toBe('to_produce');
  });

  it('ne produit jamais d’oscillation : appliquer deux fois donne le même état', () => {
    const etats: ProductionStatus[] = ['to_produce', 'producing', 'ready', 'shipped'];
    for (const depart of etats) {
      for (const s of ['unfulfilled', 'in_progress', 'partial', 'fulfilled'] as const) {
        const un = fromShopify(s, depart) ?? depart;
        const deux = fromShopify(s, un) ?? un;
        expect(deux).toBe(un);
      }
    }
  });
});

describe('toShopify', () => {
  it('laisse « ready » sans équivalent (étape purement interne)', () => {
    expect(toShopify('ready')).toBeNull();
  });

  it('traduit les étapes que Shopify connaît', () => {
    expect(toShopify('to_produce')).toBe('unfulfilled');
    expect(toShopify('producing')).toBe('in_progress');
    expect(toShopify('shipped')).toBe('fulfilled');
  });
});
