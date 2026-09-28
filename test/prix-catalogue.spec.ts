import {
  cleCatalogue,
  prixArticles,
  prixDevisSimple,
  prixFamille,
  prixPalier,
} from '../src/quotes/prix-catalogue';
import type { PricingPayload } from '../src/admin/pricing.service';
import { dashboardPage } from '../src/admin/admin.view';
import type { Quote } from '../src/database/entities/quote.entity';

/**
 * Prix catalogue TTC pré-remplis dans la fenêtre de chiffrage des devis.
 * Grilles = valeurs par défaut de PricingService.
 */
const PAYLOAD: PricingPayload = {
  prices: {
    sweatshirt: 60,
    tshirt: 29.5,
    tshirt_polyester: 29.5,
    coins: 0,
    drapeaux: 19.9,
    patches: 20,
    manche: 4,
  },
  tiers: {
    sweatshirt: [
      { min: 40, price: 52 },
      { min: 15, price: 53.9 },
      { min: 5, price: 56.5 },
      { min: 1, price: 60 },
    ],
    tshirt: [
      { min: 50, price: 24.5 },
      { min: 20, price: 25.9 },
      { min: 10, price: 26.5 },
      { min: 5, price: 28.9 },
      { min: 1, price: 29.5 },
    ],
    tshirt_polyester: [{ min: 1, price: 31 }],
    patches: [
      { min: 100, price: 3.5 },
      { min: 50, price: 5 },
      { min: 30, price: 9 },
      { min: 20, price: 12.5 },
      { min: 10, price: 20 },
    ],
    coins: [],
  },
};

describe('cleCatalogue', () => {
  it.each([
    ['Textile - Sweatshirt · Kaki foncé', 'sweatshirt'],
    ['T-shirt coton', 'tshirt'],
    ['Textile - T-shirt Polyester', 'tshirt_polyester'],
    ['Patch personnalisé', 'patches'],
    ['Drapeau personnalisé', 'drapeaux'],
    ['Coin métal', null],
    ['Mug', null],
    ['', null],
  ])('%s → %s', (nom, cle) => {
    expect(cleCatalogue(nom)).toBe(cle);
  });
});

describe('prixPalier', () => {
  it.each([
    [1, 60],
    [5, 56.5],
    [15, 53.9],
    [40, 52],
  ])('%i sweatshirts → %f €', (qty, prix) => {
    expect(prixPalier('sweatshirt', qty, PAYLOAD)).toBe(prix);
  });

  it.each([
    [10, 20],
    [20, 12.5],
    [99, 5],
  ])('%i patchs → %f €', (qty, prix) => {
    expect(prixPalier('patches', qty, PAYLOAD)).toBe(prix);
  });

  it('100 patchs ou plus : prix sur demande, rien de pré-rempli', () => {
    expect(prixPalier('patches', 100, PAYLOAD)).toBeNull();
    expect(prixPalier('patches', 250, PAYLOAD)).toBeNull();
  });

  it('drapeaux : prix de base, pas de grille', () => {
    expect(prixPalier('drapeaux', 3, PAYLOAD)).toBe(19.9);
  });

  it('coins métal : jamais de prix', () => {
    expect(prixPalier('coins', 50, PAYLOAD)).toBeNull();
  });
});

describe('prixArticles', () => {
  it('palier sur la quantité totale du produit ; coin sans prix', () => {
    const a = prixArticles(
      [
        { libelle: 'Patch personnalisé', options: '', qty: 10 },
        { libelle: 'Patch personnalisé', options: '', qty: 10 },
        { libelle: 'Coin métal', options: '', qty: 50 },
      ],
      PAYLOAD,
    );
    expect(a.map((x) => x.prixTtc)).toEqual([12.5, 12.5, undefined]);
  });
});

describe('prixFamille', () => {
  it('famille sweatshirt', () => {
    expect(prixFamille({ cle: 'sweatshirt', qty: 20, lignes: [] }, PAYLOAD)).toBe(53.9);
  });

  it('famille t-shirt : coton seul → prix coton', () => {
    expect(
      prixFamille(
        { cle: 'tshirt', qty: 10, lignes: ['10× T-shirt coton — Noir — M'] },
        PAYLOAD,
      ),
    ).toBe(26.5);
  });

  it('famille t-shirt mixte coton + polyester → pas de prix', () => {
    expect(
      prixFamille(
        {
          cle: 'tshirt',
          qty: 10,
          lignes: ['5× T-shirt coton — Noir', '5× T-shirt polyester — Blanc'],
        },
        PAYLOAD,
      ),
    ).toBeNull();
  });

  it('famille coin → pas de prix', () => {
    expect(prixFamille({ cle: 'coin', qty: 50, lignes: ['50× Coin métal'] }, PAYLOAD)).toBeNull();
  });
});

describe('prixDevisSimple', () => {
  it('commande de groupe t-shirt coton', () => {
    expect(
      prixDevisSimple({ group: { productType: 'tshirt', pieces: 12, rows: [] } }, PAYLOAD),
    ).toBe(26.5);
  });

  it('devis patchs seuls ≥ 100 pièces → champ laissé vide', () => {
    expect(
      prixDevisSimple(
        {
          coin: {
            name: 'Commande de patchs (120 pièces)',
            qty: 120,
            details: [
              'Total : 120 patchs (prix sur demande au-delà de 100)',
              '120× Patch personnalisé — 8 cm',
            ],
          },
        },
        PAYLOAD,
      ),
    ).toBeNull();
  });

  it('60 + 60 patchs dans un devis multi-articles → aucun prix pré-rempli', () => {
    const a = prixArticles(
      [
        { libelle: 'Patch personnalisé', options: '', qty: 60 },
        { libelle: 'Patch personnalisé', options: '', qty: 60 },
        { libelle: 'Textile - Sweatshirt', options: '', qty: 5 },
      ],
      PAYLOAD,
    );
    expect(a.map((x) => x.prixTtc)).toEqual([undefined, undefined, 56.5]);
  });

  it('devis coin seul → pas de prix', () => {
    expect(
      prixDevisSimple({ coin: { name: 'Coin', qty: 50, details: ['50× Coin métal'] } }, PAYLOAD),
    ).toBeNull();
  });
});

describe('dashboard — attributs du bouton de chiffrage', () => {
  it('porte les prix catalogue des articles', () => {
    const q = {
      id: 'q1',
      draftOrderId: '99',
      createdAt: new Date(),
      quoteData: {
        customer: { nom: 'Test', email: 't@exemple.fr' },
        coin: {
          name: 'Commande sur devis (2 articles)',
          qty: 30,
          details: ['10× Patch personnalisé — 8 cm', '20× Textile - Sweatshirt — Noir — L'],
          previews: [],
        },
      },
    } as unknown as Quote;
    const html = dashboardPage([], [q], [], 'https://exemple.fr', 'boutique', {
      pricing: PAYLOAD,
    });
    expect(html).toContain('&quot;prixTtc&quot;:20');
    expect(html).toContain('&quot;prixTtc&quot;:53.9');
  });
});
