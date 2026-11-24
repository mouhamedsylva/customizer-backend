import {
  ajouterArticles,
  fichierDeArticle,
  validerArticlesAjoutes,
} from '../src/quotes/ajout-articles';
import { appliquerQuantites, articlesDuDevis, retirerArticles } from '../src/quotes/articles-devis';

const DESIGN = { name: 'logo.png', url: 'https://res.cloudinary.com/x/image/upload/v1/customizer/commandes/devis-q1/logo.png', type: 'image/png' };

describe('validerArticlesAjoutes', () => {
  it('accepte une liste absente ou vide', () => {
    expect(validerArticlesAjoutes(undefined)).toEqual({ articles: [] });
    expect(validerArticlesAjoutes([])).toEqual({ articles: [] });
  });

  it('refuse plus de 10 articles, un libellé vide, une quantité invalide', () => {
    const a = { libelle: 'Patch', qty: 1 };
    expect(validerArticlesAjoutes(Array(11).fill(a))).toHaveProperty('erreur');
    expect(validerArticlesAjoutes([{ libelle: '  ', qty: 2 }])).toHaveProperty('erreur');
    expect(validerArticlesAjoutes([{ libelle: 'Patch', qty: 0 }])).toHaveProperty('erreur');
    expect(validerArticlesAjoutes([{ libelle: 'Patch', qty: 2.5 }])).toHaveProperty('erreur');
    expect(validerArticlesAjoutes('x')).toHaveProperty('erreur');
  });

  it('nettoie le texte (séparateur « — », « × », balises) et garde un design Cloudinary', () => {
    const r = validerArticlesAjoutes([
      { libelle: '<b>Patch</b> — brodé', options: '2× noir', qty: 20, fichier: DESIGN },
    ]) as any;
    expect(r.articles[0]).toEqual({ libelle: 'bPatch/b - brodé', options: '2x noir', qty: 20, fichier: DESIGN });
  });

  it('ignore un fichier hors Cloudinary', () => {
    const r = validerArticlesAjoutes([{ libelle: 'Patch', qty: 1, fichier: { name: 'x', url: 'https://evil.test/x.png' } }]) as any;
    expect(r.articles[0].fichier).toBeUndefined();
  });
});

describe('ajouterArticles', () => {
  const mono = () => ({
    coin: { name: 'Coin personnalisé', qty: 50, details: ['Face : logo', 'Finition : or'] },
    customer: { email: 'a@b.c' },
  });

  it('devis à produit unique : le produit devient l’article 1, l’ajout suit', () => {
    const d = ajouterArticles(mono(), [{ libelle: 'Patch brodé', options: 'Noir', qty: 20, fichier: DESIGN }], 'admin@x');
    expect(articlesDuDevis(d)).toEqual([
      { libelle: 'Coin personnalisé', options: '', qty: 50 },
      { libelle: 'Patch brodé', options: 'Noir', qty: 20 },
    ]);
    expect(d.coin.qty).toBe(70);
    expect(d.coin.qtyDemandee).toBe(50);
    expect(d.coin.details.slice(0, 2)).toEqual(['Face : logo', 'Finition : or']);
    expect(d.articlesAjoutes).toHaveLength(1);
    expect(d.historique[0].action).toBe('ajout');
    expect(fichierDeArticle(d, { libelle: 'Patch brodé', options: 'Noir', qty: 20 })).toEqual(DESIGN);
    expect(fichierDeArticle(d, { libelle: 'Coin personnalisé', options: '', qty: 50 })).toBeUndefined();
  });

  it('ne modifie pas l’original', () => {
    const o = mono();
    ajouterArticles(o, [{ libelle: 'Patch', options: '', qty: 1 }], 'a');
    expect(o).toEqual(mono());
  });

  const multi = () => ({
    coin: {
      name: 'Commande sur devis (2 articles)',
      qty: 30,
      details: ['Commande sur devis : 30 pièce(s), 2 ligne(s), 2 famille(s)', '10× Patch personnalisé — Face : A', '20× Sweatshirt — Noir'],
      familles: [
        { libelle: 'Patchs', qty: 10, lignes: ['10× Patch personnalisé — Face : A'] },
        { libelle: 'Textiles', qty: 20, lignes: ['20× Sweatshirt — Noir'] },
      ],
    },
  });

  it('devis multi-articles : ligne, famille, totaux et résumé mis à jour', () => {
    const d = ajouterArticles(multi(), [{ libelle: 'Drapeau', options: '90×150', qty: 5 }], 'a');
    const articles = articlesDuDevis(d)!;
    expect(articles).toHaveLength(3);
    expect(articles[2]).toEqual({ libelle: 'Drapeau', options: '90×150', qty: 5 });
    expect(d.coin.qty).toBe(35);
    expect(d.coin.name).toBe('Commande sur devis (3 articles)');
    expect(d.coin.details[0]).toBe('Commande sur devis : 35 pièce(s), 3 ligne(s), 3 famille(s)');
    expect(d.coin.familles).toHaveLength(3);
  });

  it('un article ajouté se retire et se corrige comme les autres', () => {
    const d = ajouterArticles(multi(), [{ libelle: 'Drapeau', options: '', qty: 5 }], 'a');
    const sans = retirerArticles(d, [2], 'a');
    expect(articlesDuDevis(sans)!.map((a) => a.libelle)).toEqual(['Patch personnalisé', 'Sweatshirt']);
    const corrige = appliquerQuantites(d, [10, 20, 8], 'a');
    expect(articlesDuDevis(corrige)![2].qty).toBe(8);
    expect(corrige.coin.qty).toBe(38);
  });

  it('refuse un doublon, une commande de groupe, un devis incohérent', () => {
    expect(() => ajouterArticles(multi(), [{ libelle: 'Sweatshirt', options: 'Noir', qty: 1 }], 'a')).toThrow(/déjà/);
    expect(() =>
      ajouterArticles({ coin: { qty: 3 }, group: { rows: [{}] } }, [{ libelle: 'P', options: '', qty: 1 }], 'a'),
    ).toThrow(/groupe/);
    expect(() =>
      ajouterArticles({ coin: { name: 'X', qty: 10, details: ['3× A'] } }, [{ libelle: 'P', options: '', qty: 1 }], 'a'),
    ).toThrow(/découpe/);
  });
});

describe('articlesPourChiffrage — un seul affichage pour tous les devis', () => {
  const { articlesPourChiffrage } = jest.requireActual('../src/quotes/articles-devis');

  it('produit unique sans ligne « N× » : article reconstitué depuis le nom', () => {
    expect(articlesPourChiffrage({ coin: { name: 'Patch personnalisé (PVC)', qty: 27, details: ['Face : Une seule face'] } }))
      .toEqual([{ libelle: 'Patch personnalisé (PVC)', options: '', qty: 27 }]);
  });

  it('devis du panier à une seule famille et un seul article', () => {
    const d = { coin: { name: 'Commande sur devis', qty: 100, details: ['Commande sur devis : 1 famille(s)'],
      familles: [{ libelle: 'Coins métal personnalisés', qty: 100, lignes: ['100× Coin métal — Recto verso'] }] } };
    expect(articlesPourChiffrage(d)).toEqual([{ libelle: 'Coin métal', options: 'Recto verso', qty: 100 }]);
  });

  it('plusieurs articles : ceux de articlesDuDevis ; groupe ou incohérent : null', () => {
    expect(articlesPourChiffrage({ coin: { qty: 30, details: ['10× A', '20× B'] } })).toHaveLength(2);
    expect(articlesPourChiffrage({ coin: { qty: 3 }, group: { rows: [{}] } })).toBeNull();
    expect(articlesPourChiffrage({ coin: { name: 'X', qty: 10, details: ['3× A'] } })).toBeNull();
  });

  it('un article s’ajoute aussi à un devis à une seule famille', () => {
    const d = { coin: { name: 'Commande sur devis', qty: 100, details: [],
      familles: [{ libelle: 'Coins', qty: 100, lignes: ['100× Coin métal — Recto verso'] }] } };
    const r = ajouterArticles(d, [{ libelle: 'Patch', options: '', qty: 10 }], 'a');
    expect(articlesDuDevis(r)!.map((a) => a.libelle)).toEqual(['Coin métal', 'Patch']);
    expect(retirerArticles(r, [1], 'a').coin.qty).toBe(100);
  });
});
