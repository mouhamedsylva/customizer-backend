import {
  PricingPayload,
  ProductKey,
  PRIX_HT_KEYS,
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
 * À partir de ce nombre de patchs, le prix est « sur demande » : aucun prix
 * n'est pré-rempli, l'admin le saisit lui-même. AU-DELÀ de 100 : à 100 pile,
 * le palier (3,50 € HT) s'applique — même seuil que `patchQtyInCart() > 100`
 * dans conf-cart-quote.js.
 */
export const SEUIL_PATCHS_SUR_DEMANDE = 101;

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
  return palierDepuisGrille(qty, grilleDe(key, payload));
}

/**
 * Grille de prix d'un produit, sous une forme AUTONOME : tout ce qu'il faut
 * pour calculer un palier, sans le payload ni les constantes du module.
 * Servie telle quelle à la fenêtre de chiffrage (recalcul quand l'admin
 * corrige une quantité).
 */
export interface GrillePrix {
  /** Paliers triés par `min` décroissant (comme le payload). */
  tiers: Array<{ min: number; price: number }>;
  /** Prix de base TTC, ou 0. */
  base: number;
  /** Produit vendu sur devis : jamais de prix catalogue. */
  surDevis: boolean;
  /** À partir de cette quantité, prix « sur demande » (patchs : 100), ou 0. */
  surDemandeDes: number;
  /** Prix HORS TAXE (patchs) : la fenêtre ajoute la TVA, au lieu de le
      prendre pour un prix TTC catalogue. */
  enHt: boolean;
}

export function grilleDe(key: ProductKey, payload: PricingPayload): GrillePrix {
  const tiers = payload.tiers?.[key];
  const base = Number(payload.prices?.[key]);
  return {
    tiers: Array.isArray(tiers) ? tiers.filter((t) => t && t.price > 0) : [],
    base: Number.isFinite(base) && base > 0 ? base : 0,
    surDevis: QUOTE_ONLY_KEYS.includes(key),
    surDemandeDes: key === 'patches' ? SEUIL_PATCHS_SUR_DEMANDE : 0,
    enHt: prixEnHt(key),
  };
}

/**
 * Prix unitaire TTC pour `qty` pièces d'après une grille : premier palier
 * atteint, sinon le prix de base ; null quand aucun prix n'a de sens.
 *
 * ⚠ Fonction AUTONOME, injectée telle quelle dans la page (String(fonction)) :
 * aucune variable du module, pas de gabarit `${…}` ni d'accent grave.
 */
export function palierDepuisGrille(qty: number, grille: GrillePrix | null | undefined): number | null {
  if (!grille || grille.surDevis) return null;
  if (grille.surDemandeDes && qty >= grille.surDemandeDes) return null;
  for (const t of grille.tiers || []) {
    if (t.min <= qty && t.price > 0) return t.price;
  }
  return grille.base > 0 ? grille.base : null;
}

/** Clé catalogue d'un devis à produit unique (même règle que prixDevisSimple). */
export function cleDevisSimple(quoteData: any): ProductKey | null {
  const coin = quoteData?.coin;
  if (!coin || quoteData?.group) return null;
  return cleUnique(lire(coin.details)) ?? cleCatalogue(coin.name);
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
  const key = cleFamille(f);
  return key ? prixPalier(key, qty, payload) : null;
}

/** Les prix catalogue de ce produit sont-ils HT (patchs) plutôt que TTC ? */
export function prixEnHt(key: ProductKey | null | undefined): boolean {
  return !!key && PRIX_HT_KEYS.includes(key);
}

/** Clé catalogue d'une FAMILLE du devis, ou null (voir prixFamille). */
export function cleFamille(f: any): ProductKey | null {
  if (!f) return null;
  const parLignes = cleUnique(lire(f.lignes));
  const parCle: Record<string, ProductKey> = {
    sweatshirt: 'sweatshirt',
    drapeau: 'drapeaux',
    patch: 'patches',
  };
  // Les lignes contredisent la clé (famille « patch » contenant autre chose) :
  // on s'abstient plutôt que de deviner.
  if (parLignes && parCle[String(f.cle || '')] && parCle[String(f.cle)] !== parLignes) {
    return null;
  }
  return parLignes ?? parCle[String(f.cle || '')] ?? null;
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
