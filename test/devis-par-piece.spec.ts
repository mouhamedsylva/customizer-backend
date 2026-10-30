import { appliquerQuantites, articlesDuDevis, regrouperLignes } from '../src/quotes/articles-devis';

/**
 * Devis enregistré avec UNE LIGNE PAR PIÈCE (répartition par tailles, avant la
 * correction du thème) — cas du devis Severin Fredj : 2 × 50 coins, 33 t-shirts
 * coton et 33 polyester, en 68 lignes. La fenêtre de chiffrage et le brouillon
 * Shopify doivent n'en voir que 4.
 */
const COIN_A = '50× Coin métal — Type : Recto verso · Forme : Rond · Taille : 30 mm · Finition : Nickel noir';
const COIN_B = '50× Coin métal — Type : Recto verso numéroté · Forme : Rond · Taille : 30 mm · Finition : Nickel noir';
const COTON = '1× T-shirt coton — Couleur : Camel — M';
const POLY = '1× T-shirt polyester — Couleur : Noir — M';

function devisParPiece() {
  const tshirts = [...Array(33).fill(COTON), ...Array(33).fill(POLY)];
  return {
    coin: {
      name: 'Commande sur devis (68 articles)',
      qty: 166,
      details: ['Commande sur devis : 2 famille(s), 68 ligne(s), 166 pièce(s).', COIN_A, COIN_B, ...tshirts],
      familles: [
        { cle: 'coin', libelle: 'Coins métal personnalisés', qty: 100, lignes: [COIN_A, COIN_B] },
        { cle: 'tshirt', libelle: 'T-shirts personnalisés', qty: 66, lignes: tshirts },
      ],
    },
  };
}

describe('devis à une ligne par pièce : articles regroupés', () => {
  it('regroupe les lignes « 1× » identiques, garde les options distinctes', () => {
    expect(
      regrouperLignes(['Résumé', '1× T — Camel — M', '1× T — Camel — L', '1× T — Camel — M']),
    ).toEqual(['Résumé', '2× T — Camel — M', '1× T — Camel — L']);
  });

  it('deux lignes « 10× » identiques restent deux articles (deux designs)', () => {
    expect(regrouperLignes(['10× Patch — Rond', '10× Patch — Rond'])).toEqual(['10× Patch — Rond', '10× Patch — Rond']);
  });

  it('la fenêtre et le brouillon voient 4 articles : 50, 50, 33, 33', () => {
    const a = articlesDuDevis(devisParPiece());
    expect(a).not.toBeNull();
    expect(a!.map((x) => [x.libelle, x.qty])).toEqual([
      ['Coin métal', 50],
      ['Coin métal', 50],
      ['T-shirt coton', 33],
      ['T-shirt polyester', 33],
    ]);
  });

  it('corriger une quantité réécrit le devis sous forme regroupée', () => {
    const d = appliquerQuantites(devisParPiece(), [50, 50, 30, 33], 'admin@x.fr');
    expect(d.coin.qty).toBe(163);
    expect(d.coin.details).toContain('30× T-shirt coton — Couleur : Camel — M');
    expect(d.coin.details).toContain('33× T-shirt polyester — Couleur : Noir — M');
    expect(d.coin.details.filter((l: string) => /T-shirt/.test(l))).toHaveLength(2);
    expect(d.coin.familles[1]).toMatchObject({ qty: 63 });
    expect(d.coin.familles[1].lignes).toEqual([
      '30× T-shirt coton — Couleur : Camel — M',
      '33× T-shirt polyester — Couleur : Noir — M',
    ]);
    // Le résumé suit le nouveau total.
    expect(d.coin.details[0]).toMatch(/163 pièce\(s\)/);
  });
});

describe('retrait d’un article du devis (le client s’est trompé)', () => {
  const { retirerArticles, articlesOuUnique } = require('../src/quotes/articles-devis');

  it('retirer le coin n° 2 laisse 3 articles cohérents, résumé et historique à jour', () => {
    const d = retirerArticles(devisParPiece(), [1], 'admin@x.fr');
    expect(articlesDuDevis(d)!.map((x) => [x.libelle, x.qty])).toEqual([
      ['Coin métal', 50],
      ['T-shirt coton', 33],
      ['T-shirt polyester', 33],
    ]);
    expect(d.coin.qty).toBe(116);
    expect(d.coin.details[0]).toBe('Commande sur devis : 2 famille(s), 3 ligne(s), 116 pièce(s).');
    expect(d.coin.familles[0]).toMatchObject({ qty: 50, lignes: [COIN_A] });
    expect(d.coin.name).toBe('Commande sur devis (3 articles)');
    expect(d.coin.qtyDemandee).toBe(166);
    expect(d.historique.at(-1)).toMatchObject({ action: 'retrait', admin: 'admin@x.fr' });
    expect(d.historique.at(-1).retires[0]).toMatch(/^50× Coin métal — Type : Recto verso numéroté/);
  });

  it('une famille vidée disparaît', () => {
    const d = retirerArticles(devisParPiece(), [0, 1], 'a');
    expect(d.coin.familles.map((f: any) => f.cle)).toEqual(['tshirt']);
    expect(d.coin.details[0]).toMatch(/^Commande sur devis : 1 famille\(s\), 2 ligne\(s\), 66 pièce\(s\)/);
  });

  it('refuse de tout retirer, ou un indice hors liste', () => {
    expect(() => retirerArticles(devisParPiece(), [0, 1, 2, 3], 'a')).toThrow(/au moins un article/);
    expect(() => retirerArticles(devisParPiece(), [7], 'a')).toThrow(/rechargez/);
  });

  it('s’il ne reste qu’un article, il reste lisible pour la facturation', () => {
    const d = retirerArticles(devisParPiece(), [1, 2, 3], 'a');
    expect(articlesDuDevis(d)).toBeNull(); // un seul article : mode « produit unique »
    expect(articlesOuUnique(d)!.map((x: any) => [x.libelle, x.qty])).toEqual([['Coin métal', 50]]);
    expect(d.coin.qty).toBe(50);
  });
});
