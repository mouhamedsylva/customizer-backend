import {
  PricingPayload,
  ProductKey,
  QUOTE_ONLY_KEYS,
} from '../admin/pricing.service';
import { ArticleDevis, lire } from './articles-devis';

/**
 * Prix CATALOGUE (TTC) des articles d'un devis, pour pré-remplir la fenêtre
 * de chiffrage du dashboard.
 *
 * Sweatshirts, t-shirts coton/polyester, patchs et drapeaux ont un prix public
 * — celui que le client a vu dans le configurateur, TAXES INCLUSES. Le devis
 * ne le conserve pas (ni prix ni `productType` par article) : on le retrouve
 * à partir du NOM du produit, comme le fait déjà le thème (`cartFamily()`,
 * conf-cart-quote.js). Les devis déjà en base en profitent donc aussi.
 *
 * Les coins métal restent sans prix : ils se chiffrent à la main.
 */

/**
 * Clé de tarif d'un article, d'après son nom (« Textile - Sweatshirt · Kaki »,
 * « Patch personnalisé », « T-shirt polyester »…). null = pas de prix catalogue.
 *
 * Les PATCHS portent la clé `patches` : c'est elle qui tient leur grille
 * (20 € → 3,50 €), cf. l'avertissement sur PRODUCT_KEYS et
 * conf-dynamic-layout.js (`tierUnitPrice("patches", q)`).
 */
export function cleCatalogue(texte: unknown): ProductKey | null {
  const n = String(texte ?? '').toLowerCase();
  if (!n) return null;
  if (/coin/.test(n)) return null; // coin métal : sur devis, avant tout le reste
  if (/patch/.test(n)) return 'patches';
  if (/sweat/.test(n)) return 'sweatshirt';
  if (/polyester/.test(n)) return 'tshirt_polyester';
  if (/t-?shirt|coton/.test(n)) return 'tshirt';
  if (/drapeau/.test(n)) return 'drapeaux';
  return null;
}

/**
 * À partir de ce nombre de patchs, le prix est « sur demande » (même seuil
 * que `patchQtyInCart() >= 100` dans conf-cart-quote.js) : aucun prix n'est
 * pré-rempli, l'admin le saisit lui-même.
 */
export const SEUIL_PATCHS_SUR_DEMANDE = 100;

/**
 * Prix unitaire TTC pour `qty` pièces : premier palier atteint de la grille
 * dégressive (triée par `min` décroissant), sinon le prix de base. Même règle
 * que `tierUnitPrice()` du configurateur. null si aucun prix n'a de sens.
 */
export function prixPalier(
  key: ProductKey,
  qty: number,
  payload: PricingPayload,
): number | null {
  if (QUOTE_ONLY_KEYS.includes(key)) return null;
  if (key === 'patches' && qty >= SEUIL_PATCHS_SUR_DEMANDE) return null;
  const grille = payload.tiers?.[key];
  if (Array.isArray(grille)) {
    for (const t of grille) {
      if (t && t.min <= qty && t.price > 0) return t.price;
    }
  }
  const base = Number(payload.prices?.[key]);
  return Number.isFinite(base) && base > 0 ? base : null;
}

export type ArticlePrixe = ArticleDevis & { prixTtc?: number };

/**
 * Ajoute `prixTtc` aux articles qui ont un prix catalogue. Le palier se lit
 * sur la quantité TOTALE du même produit dans le devis, comme
 * `effectiveUnitPrice(item, totalsByType)` côté configurateur : 2 lignes de
 * 10 patchs = 20 patchs = palier à 12,50 €.
 */
export function prixArticles(
  articles: ArticleDevis[],
  payload: PricingPayload,
): ArticlePrixe[] {
  const cles = articles.map((a) => cleCatalogue(a.libelle));
  const totaux = new Map<ProductKey, number>();
  cles.forEach((k, i) => {
    if (k) totaux.set(k, (totaux.get(k) || 0) + articles[i].qty);
  });
  return articles.map((a, i) => {
    const k = cles[i];
    const prix = k ? prixPalier(k, totaux.get(k)!, payload) : null;
    return prix != null ? { ...a, prixTtc: prix } : { ...a };
  });
}

/** Clé commune à un ensemble de lignes (« 10× T-shirt coton — … »), ou null
 *  si elles sont vides, inconnues ou de produits différents. */
function cleUnique(lignes: ArticleDevis[]): ProductKey | null {
  if (!lignes.length) return null;
  const cles = new Set(lignes.map((l) => cleCatalogue(l.libelle)));
  if (cles.size !== 1) return null;
  return [...cles][0];
}

/**
 * Prix TTC d'une FAMILLE du devis ({cle, libelle, qty, lignes}).
 *
 * La famille `tshirt` regroupe coton ET polyester : on ne donne un prix que
 * si toutes ses lignes désignent le même t-shirt. Un prix unique pour deux
 * produits de tarifs différents serait faux pour l'un des deux.
 */
export function prixFamille(f: any, payload: PricingPayload): number | null {
  if (!f) return null;
  const qty = Number(f.qty) || 0;
  if (qty <= 0) return null;
  const parLignes = cleUnique(lire(f.lignes));
  const parCle: Record<string, ProductKey> = {
    sweatshirt: 'sweatshirt',
    drapeau: 'drapeaux',
    patch: 'patches',
  };
  const key = parLignes ?? parCle[String(f.cle || '')] ?? null;
  // Les lignes contredisent la clé (famille « patch » contenant autre chose) :
  // on s'abstient plutôt que de deviner.
  if (parLignes && parCle[String(f.cle || '')] && parCle[String(f.cle)] !== parLignes) {
    return null;
  }
  return key ? prixPalier(key, qty, payload) : null;
}

/**
 * Prix TTC pour la fenêtre de chiffrage À PRIX UNIQUE (un seul produit) :
 * - commande de groupe : son type de textile, sur le nombre de pièces ;
 * - sinon : les lignes de `coin.details`, si elles désignent toutes le même
 *   produit catalogue.
 */
export function prixDevisSimple(
  quoteData: any,
  payload: PricingPayload,
): number | null {
  const group = quoteData?.group;
  if (group) {
    const key = cleCatalogue(group.productType) ?? cleCatalogue(group.productLabel);
    const rows: any[] = Array.isArray(group.rows) ? group.rows : [];
    const pieces =
      Number(group.pieces) || rows.reduce((s, r) => s + (Number(r?.qty) || 0), 0);
    return key && pieces > 0 ? prixPalier(key, pieces, payload) : null;
  }
  const coin = quoteData?.coin;
  const qty = Number(coin?.qty) || 0;
  if (qty <= 0) return null;
  const key = cleUnique(lire(coin.details)) ?? cleCatalogue(coin.name);
  return key ? prixPalier(key, qty, payload) : null;
}
