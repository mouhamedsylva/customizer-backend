import {
  TVA_TAUX_DEFAUT,
  envoiEnTtc,
  prixUnitaireEnvoye,
  scriptTva,
  tauxTva,
  ttcLigne,
  type ReglagesTva,
} from '../src/shared/tva';
import { ShopifyService } from '../src/shared/shopify.service';

/**
 * TVA de la fenêtre de chiffrage. Cas de la revue : 12,50 € HT × 50.
 * Ces fonctions sont celles qu'exécute le navigateur (injectées par scriptTva).
 */
const cfg = (c: Partial<ReglagesTva>): ReglagesTva => ({ rate: null, taxesIncluded: null, taxExempt: false, ...c });

describe('calcul de TVA', () => {
  it('suppose 20 % tant que le taux est inconnu', () => {
    expect(tauxTva(cfg({}))).toBe(TVA_TAUX_DEFAUT);
    expect(tauxTva(cfg({ rate: 0 }))).toBe(0); // « aucune taxe » n'est pas « inconnu »
    expect(tauxTva(cfg({ rate: 0.2, taxExempt: true }))).toBe(0);
  });

  it('boutique HT : Shopify ajoute la TVA au HT envoyé', () => {
    const ht = cfg({ taxesIncluded: false });
    expect(envoiEnTtc(ht)).toBe(false);
    expect(prixUnitaireEnvoye(12.5, { ...ht, rate: 0 })).toBe(12.5);
    expect(ttcLigne(12.5, 50, { ...ht, rate: 0 })).toBe(625);
    expect(ttcLigne(12.5, 50, { ...ht, rate: 0.2 })).toBe(750);
  });

  it('boutique TTC : le prix envoyé est converti et arrondi au centime', () => {
    const ttc = cfg({ taxesIncluded: true, rate: 0.2 });
    expect(prixUnitaireEnvoye(12.5, ttc)).toBe(15);
    expect(ttcLigne(12.5, 50, ttc)).toBe(750);
    expect(prixUnitaireEnvoye(10.01, ttc)).toBe(12.01); // 12,012 → 12,01
  });

  it('client exonéré : le HT part tel quel', () => {
    const ex = cfg({ taxesIncluded: true, rate: 0.2, taxExempt: true });
    expect(prixUnitaireEnvoye(12.5, ex)).toBe(12.5);
    expect(ttcLigne(12.5, 50, ex)).toBe(625);
  });

  it('le script injecté dans la page calcule pareil', () => {
    const f = new Function(`${scriptTva()}; return { ttcLigne, prixUnitaireEnvoye };`)();
    expect(f.ttcLigne(12.5, 50, cfg({ taxesIncluded: false, rate: 0 }))).toBe(625);
    expect(f.prixUnitaireEnvoye(12.5, cfg({ taxesIncluded: true, rate: 0.2 }))).toBe(15);
  });
});

describe('ShopifyService.lireTaxes', () => {
  it('brouillon à 0 € : taux inconnu', () => {
    expect(ShopifyService.lireTaxes({ subtotal_price: '0.00', total_tax: '0.00', tax_lines: [] }).rate).toBeNull();
  });
  it('brouillon chiffré sans aucune taxe : 0 %, pas « inconnu »', () => {
    expect(ShopifyService.lireTaxes({ subtotal_price: '625.00', total_tax: '0.00', tax_lines: [] }).rate).toBe(0);
  });
  it('taxes présentes : somme des taux', () => {
    const t = ShopifyService.lireTaxes({
      subtotal_price: '625.00',
      total_tax: '125.00',
      tax_lines: [{ rate: 0.2 }],
      taxes_included: false,
    });
    expect(t.rate).toBe(0.2);
    expect(t.taxesIncluded).toBe(false);
  });

  it('une même TVA listée par ligne ne compte qu’une fois (devis de 68 lignes)', () => {
    const tax_lines = Array.from({ length: 68 }, () => ({ title: 'TVA', rate: 0.2, price: '4.32' }));
    const t = ShopifyService.lireTaxes({ subtotal_price: '1709.40', total_tax: '284.90', tax_lines });
    expect(t.rate).toBe(0.2); // et non 13,6 (1 360 %)
    // Coin sans prix unitaire, saisi 9 € HT × 50 : 540 € TTC, et non 6 570 €.
    expect(ttcLigne(9, 50, cfg({ taxesIncluded: false, rate: t.rate }))).toBe(540);
    expect(ttcLigne(9, 50, cfg({ taxesIncluded: true, rate: t.rate }))).toBe(540);
  });

  it('des taxes différentes se cumulent toujours (TPS + TVQ)', () => {
    const t = ShopifyService.lireTaxes({
      subtotal_price: '100.00',
      total_tax: '14.98',
      tax_lines: [{ title: 'TPS', rate: 0.05 }, { title: 'TVQ', rate: 0.09975 }],
    });
    expect(t.rate).toBeCloseTo(0.14975, 5);
  });

  it('cumul incohérent (> 100 %) : repli sur le taux d’une ligne d’article', () => {
    const t = ShopifyService.lireTaxes({
      subtotal_price: '100.00',
      total_tax: '20.00',
      tax_lines: [{ title: 'A', rate: 0.9 }, { title: 'B', rate: 0.9 }],
      line_items: [{ tax_lines: [{ title: 'TVA', rate: 0.2 }] }],
    });
    expect(t.rate).toBe(0.2);
  });
});

describe('fenêtre de chiffrage : récapitulatif TVA séparé', () => {
  it('le script de la page distingue prix catalogue (TTC) et articles saisis HT', () => {
    const { dashboardPage } = require('../src/admin/admin.view');
    const html: string = dashboardPage([], [], [], 'https://x', '', { limits: { orders: 300, quotes: 500 } });
    expect(html).toContain('function afficherTvaFamilles(lu)');
    expect(html).toContain('Articles au prix catalogue');
    expect(html).toContain('Articles sans prix unitaire');
    // Les scripts de la page restent syntaxiquement valides.
    const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) if (m[1].trim()) expect(() => new Function(m![1])).not.toThrow();
  });
});
