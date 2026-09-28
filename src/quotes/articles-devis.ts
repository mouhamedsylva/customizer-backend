/**
 * Articles d'un devis multi-produits, pour le chiffrer LIGNE PAR LIGNE.
 *
 * Le thème (conf-cart-quote.js, `requestMultiProductQuote`) envoie une ligne
 * de détail par article du panier : « 10× Patch personnalisé — Face : … ».
 * C'est la seule trace fiable des articles pour TOUS les devis — ceux
 * d'avant le 23 septembre 2026 n'ont pas de `familles`, et les familles
 * regroupent de toute façon plusieurs articles sous un seul prix.
 *
 * Tout ou rien : si la somme des quantités ne retombe pas sur `coin.qty`,
 * on renvoie null et la fenêtre de chiffrage garde son mode actuel. Un
 * découpage deviné ferait facturer de mauvaises quantités.
 */
export interface ArticleDevis {
  /** Nom du produit (« Patch personnalisé »), titre de la ligne Shopify. */
  libelle: string;
  /** Options choisies (« Face : … · Taille : 8 cm »), ou chaîne vide. */
  options: string;
  qty: number;
}

const LIGNE = /^\s*(\d+)\s*×\s*(.+?)\s*$/;

/** Lignes « N× Produit — options » d'une liste brute ; le reste est ignoré. */
export function lire(lignes: unknown): ArticleDevis[] {
  if (!Array.isArray(lignes)) return [];
  const out: ArticleDevis[] = [];
  for (const brut of lignes) {
    const m = LIGNE.exec(String(brut ?? ''));
    if (!m) continue; // pastille résumé « Commande sur devis : … », texte libre
    const qty = Number(m[1]);
    if (!Number.isInteger(qty) || qty <= 0) continue;
    const [libelle, ...reste] = m[2].split(' — ');
    out.push({
      libelle: libelle.trim().slice(0, 200) || 'Article',
      options: reste.join(' — ').trim().slice(0, 500),
      qty,
    });
  }
  return out;
}

export function articlesDuDevis(quoteData: any): ArticleDevis[] | null {
  const coin = quoteData?.coin;
  if (!coin || quoteData?.group?.rows?.length) return null; // commande de groupe : autre mode
  const total = Number(coin.qty);
  if (!Number.isFinite(total) || total <= 0) return null;

  const candidats = [
    lire(coin.details),
    lire((Array.isArray(coin.familles) ? coin.familles : []).flatMap((f: any) => f?.lignes ?? [])),
  ];
  for (const articles of candidats) {
    if (articles.length >= 2 && articles.reduce((s, a) => s + a.qty, 0) === total) {
      return articles;
    }
  }
  return null;
}
