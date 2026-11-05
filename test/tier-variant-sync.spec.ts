import {
  libellePalier,
  planifierPaliers,
  seuilDuLibelle,
  TierVariantSyncService,
  ANCIEN_PREFIXE_REMISE,
} from '../src/admin/tier-variant-sync.service';
import type { StructureProduit, VariantStructure } from '../src/shared/shopify.service';
import type { Tier } from '../src/admin/pricing.service';

const GRILLE_SWEAT: Tier[] = [
  { min: 40, price: 52 },
  { min: 15, price: 53.9 },
  { min: 5, price: 56.5 },
  { min: 1, price: 60 },
];

function v(id: string, price: number, options: Record<string, string>, mediaId: string | null = null): VariantStructure {
  return { id, price, options, mediaId };
}

function sweat(variants: VariantStructure[], avecPalier = true): StructureProduit {
  return {
    id: 'gid://shopify/Product/1',
    title: 'Textile - Sweatshirt',
    optionNames: avecPalier ? ['Couleur', 'Palier'] : ['Couleur'],
    variants,
  };
}

describe('libellés de palier', () => {
  it('sont stables et relisibles', () => {
    expect(libellePalier(1)).toBe('Dès 1 pièce');
    expect(libellePalier(20)).toBe('Dès 20 pièces');
    expect(seuilDuLibelle('Dès 20 pièces')).toBe(20);
    expect(seuilDuLibelle('Default Title')).toBeNull();
  });
});

describe('planifierPaliers', () => {
  it('sans option Palier : se limite à la créer avec le plus petit palier', () => {
    const p = planifierPaliers(sweat([v('a', 60, { Couleur: 'Noir' })], false), GRILLE_SWEAT);
    expect(p.creerOption).toBe('Dès 1 pièce');
    expect(p.creer).toHaveLength(0);
    expect(p.supprimer).toHaveLength(0);
  });

  it('crée les paliers manquants pour chaque couleur, avec l\'image de la couleur', () => {
    const p = planifierPaliers(
      sweat([
        v('a', 60, { Couleur: 'Noir', Palier: 'Dès 1 pièce' }, 'media-noir'),
        v('b', 60, { Couleur: 'Taupe', Palier: 'Dès 1 pièce' }, 'media-taupe'),
      ]),
      GRILLE_SWEAT,
    );
    expect(p.creer).toHaveLength(6);
    expect(p.creer).toContainEqual({
      options: { Couleur: 'Taupe', Palier: 'Dès 15 pièces' }, price: 53.9, mediaId: 'media-taupe',
    });
    expect(p.modifierPrix).toHaveLength(0);
    expect(p.supprimer).toHaveLength(0);
  });

  it('corrige un prix et supprime un palier retiré de la grille', () => {
    const p = planifierPaliers(
      sweat([
        v('a', 60, { Couleur: 'Noir', Palier: 'Dès 1 pièce' }),
        v('b', 55, { Couleur: 'Noir', Palier: 'Dès 5 pièces' }),
        v('c', 53.9, { Couleur: 'Noir', Palier: 'Dès 15 pièces' }),
        v('d', 52, { Couleur: 'Noir', Palier: 'Dès 40 pièces' }),
        v('e', 51, { Couleur: 'Noir', Palier: 'Dès 100 pièces' }),
      ]),
      GRILLE_SWEAT,
    );
    expect(p.modifierPrix).toEqual([{ id: 'b', price: 56.5 }]);
    expect(p.supprimer).toEqual(['e']);
    expect(p.creer).toHaveLength(0);
  });

  it('patch sans couleur : un variant par palier, seules les options existantes', () => {
    const p = planifierPaliers(
      {
        id: 'gid://shopify/Product/2',
        title: 'Patch personnalisé',
        optionNames: ['Palier'],
        variants: [v('p', 20, { Palier: 'Dès 10 pièces' }, 'm')],
      },
      [
        { min: 100, price: 3.5 },
        { min: 50, price: 5 },
        { min: 30, price: 9 },
        { min: 20, price: 12.5 },
        { min: 10, price: 20 },
      ],
    );
    expect(p.creer.map((c) => c.options)).toEqual([
      { Palier: 'Dès 20 pièces' },
      { Palier: 'Dès 30 pièces' },
      { Palier: 'Dès 50 pièces' },
      { Palier: 'Dès 100 pièces' },
    ]);
  });

  it('grille vide : ne touche à rien', () => {
    const p = planifierPaliers(sweat([v('a', 60, { Couleur: 'Noir', Palier: 'Dès 1 pièce' })]), []);
    expect(p.grilleVide).toBe(true);
    expect(p.creer.length + p.supprimer.length + p.modifierPrix.length).toBe(0);
  });

  it('conserve un variant au palier illisible', () => {
    const p = planifierPaliers(
      sweat([
        v('a', 60, { Couleur: 'Noir', Palier: 'Dès 1 pièce' }),
        v('x', 60, { Couleur: 'Noir', Palier: 'Spécial' }),
      ]),
      [{ min: 1, price: 60 }],
    );
    expect(p.supprimer).toHaveLength(0);
    expect(p.avertissements.join(' ')).toContain('Spécial');
  });
});

describe('TierVariantSyncService.synchroniser', () => {
  const SWEAT_ID = '15982847033678';

  function build(opts: { structureOk?: boolean } = {}) {
    let lectures = 0;
    const shopify = {
      getProductStructure: jest.fn(async (id: string) => {
        if (id !== SWEAT_ID || opts.structureOk === false) return { ok: false, error: 'introuvable' };
        lectures++;
        // 1re lecture : pas d'option ; ensuite : option créée.
        return {
          ok: true,
          product: sweat(
            [v('gid://shopify/ProductVariant/1', 60, lectures === 1
              ? { Couleur: 'Noir' }
              : { Couleur: 'Noir', Palier: 'Dès 1 pièce' })],
            lectures > 1,
          ),
        };
      }),
      createProductOption: jest.fn(async () => ({ ok: true })),
      bulkCreateVariants: jest.fn(async (_p: string, vs: unknown[]) => ({ ok: true, created: vs.length })),
      bulkUpdateVariantPrices: jest.fn(async () => ({ ok: true })),
      bulkDeleteVariants: jest.fn(async () => ({ ok: true })),
      listAutomaticDiscounts: jest.fn(async () => ({
        ok: true,
        discounts: [
          { id: 'd-sweat', title: `${ANCIEN_PREFIXE_REMISE}Sweatshirt (5+)`, productIds: [SWEAT_ID] },
          { id: 'd-patch', title: `${ANCIEN_PREFIXE_REMISE}Patch (20+)`, productIds: ['15982850801998'] },
          { id: 'd-client', title: 'Soldes hiver', productIds: [SWEAT_ID] },
        ],
      })),
      deleteAutomaticDiscount: jest.fn(async () => ({ ok: true })),
    };
    const pricing = { getTiers: jest.fn(async () => ({ sweatshirt: GRILLE_SWEAT })) };
    return { svc: new TierVariantSyncService(pricing as any, shopify as any), shopify };
  }

  it('crée l\'option, relit, crée les paliers, puis purge SEULEMENT les remises des produits réussis', async () => {
    const { svc, shopify } = build();
    const r = await svc.synchroniser();
    expect(shopify.createProductOption).toHaveBeenCalledWith('gid://shopify/Product/1', 'Palier', 'Dès 1 pièce');
    expect(r.variantsCrees).toBe(3);
    // d-patch : produit en échec (illisible) -> remise conservée ; d-client : pas à nous.
    expect(shopify.deleteAutomaticDiscount.mock.calls.map((c) => c[0])).toEqual(['d-sweat']);
    expect(r.remisesSupprimees).toBe(1);
  });

  it('produit illisible : aucune écriture, aucune remise supprimée', async () => {
    const { svc, shopify } = build({ structureOk: false });
    const r = await svc.synchroniser();
    expect(r.ok).toBe(false);
    expect(shopify.bulkCreateVariants).not.toHaveBeenCalled();
    expect(shopify.deleteAutomaticDiscount).not.toHaveBeenCalled();
  });
});
