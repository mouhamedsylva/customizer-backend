/**
 * AJOUT D'ARTICLES À UN DEVIS, depuis la fenêtre de chiffrage.
 *
 * L'admin peut compléter le devis du client (« ajoutez aussi 20 patchs
 * brodés »). Ces articles sont à libellé libre, et peuvent porter un fichier
 * de design pour la production.
 *
 * Un article ajouté devient un article COMME LES AUTRES : une ligne
 * « N× Libellé — options » dans `coin.details`, que `articlesDuDevis` relit.
 * Il se chiffre, se corrige et se retire donc avec les mêmes outils, et part
 * sur la facture Shopify comme une ligne propre.
 *
 * Son fichier est conservé dans `quoteData.articlesAjoutes` : il est posé sur
 * la ligne Shopify (propriété « Design »), et la commande payée l'emporte
 * jusqu'à la fiche de production.
 */
import {
  ArticleDevis,
  articlesDuDevis,
  articlesOuUnique,
  lire,
  quantiteValide,
  regrouperLignes,
} from './articles-devis';
import { piecesValides } from './pieces-jointes';

/** Au plus 10 articles ajoutés par envoi : une facture reste lisible. */
export const MAX_ARTICLES_AJOUTES = 10;

export interface FichierArticle {
  name: string;
  url: string;
  type?: string;
}

export interface ArticleAjoute {
  libelle: string;
  options: string;
  qty: number;
  fichier?: FichierArticle;
}

/** Texte sur une ligne, sans le séparateur « — » (il découpe libellé et
    options) ni balises, borné. */
function texte(v: unknown, max: number): string {
  return String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+—\s+/g, ' - ')
    .replace(/×/g, 'x')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

/** Articles ajoutés reçus du navigateur : validés, ou une erreur lisible. */
export function validerArticlesAjoutes(
  brut: unknown,
): { articles: ArticleAjoute[] } | { erreur: string } {
  if (brut === undefined || brut === null) return { articles: [] };
  if (!Array.isArray(brut)) return { erreur: 'Articles ajoutés illisibles.' };
  if (brut.length > MAX_ARTICLES_AJOUTES) {
    return { erreur: `${MAX_ARTICLES_AJOUTES} articles ajoutés au plus.` };
  }
  const articles: ArticleAjoute[] = [];
  for (let i = 0; i < brut.length; i++) {
    const a = (brut[i] || {}) as Record<string, unknown>;
    const libelle = texte(a.libelle, 120);
    if (!libelle) return { erreur: `Indiquez le nom de l'article ajouté n° ${i + 1}.` };
    const qty = Number(a.qty);
    if (!quantiteValide(qty)) {
      return { erreur: `Quantité invalide pour « ${libelle} » (entier de 1 à 100 000).` };
    }
    const [fichier] = a.fichier ? piecesValides([a.fichier]) : [];
    articles.push({ libelle, options: texte(a.options, 300), qty, ...(fichier ? { fichier } : {}) });
  }
  return { articles };
}

const ligneDe = (a: { qty: number; libelle: string; options: string }) =>
  `${a.qty}× ${a.libelle}${a.options ? ' — ' + a.options : ''}`;
const contenu = (a: { libelle: string; options: string }) => `${a.libelle}|${a.options}`;

/**
 * Ajoute des articles au devis et renvoie une COPIE modifiée.
 *
 * - Devis à produit unique (sans ligne « N× ») : le produit d'origine devient
 *   l'article 1 (« N× <nom du produit> »), les ajouts suivent.
 * - `coin.qty`, le nom « (N articles) » et la pastille résumé sont tenus à jour ;
 *   un devis à familles reçoit une famille par article ajouté, pour que le
 *   retrait et la correction de quantité retrouvent chaque ligne.
 *
 * Lève une Error si le devis ne se découpe pas en articles (commande de
 * groupe, données incohérentes) ou si un ajout est identique à un article
 * existant (les lignes « 1× » identiques fusionneraient).
 */
export function ajouterArticles(
  quoteData: any,
  ajouts: ArticleAjoute[],
  admin: string,
  maintenant: Date = new Date(),
): any {
  if (!ajouts.length) return quoteData;
  const coin = quoteData?.coin;
  if (!coin || quoteData?.group?.rows?.length) {
    throw new Error("On n'ajoute pas d'article à une commande de groupe.");
  }
  const copie = JSON.parse(JSON.stringify(quoteData));
  const c = copie.coin;
  c.details = regrouperLignes(Array.isArray(c.details) ? c.details : []);

  let existants: ArticleDevis[] | null = articlesOuUnique(copie);
  if (!existants) {
    const familles = Array.isArray(c.familles) && c.familles.length > 0;
    const qty = Number(c.qty);
    if (lire(c.details).length || familles || !quantiteValide(qty)) {
      throw new Error("Ce devis ne se découpe pas en articles : ajoutez l'article dans Shopify.");
    }
    // Produit unique : il devient l'article 1, sans options.
    const premier = { qty, libelle: texte(c.name, 120) || 'Article', options: '' };
    c.details.push(ligneDe(premier));
    existants = [premier];
  }

  const vus = new Set(existants.map(contenu));
  for (const a of ajouts) {
    if (vus.has(contenu(a))) {
      throw new Error(`« ${a.libelle} » figure déjà sur le devis : corrigez plutôt sa quantité.`);
    }
    vus.add(contenu(a));
    c.details.push(ligneDe(a));
    if (Array.isArray(c.familles)) c.familles.push({ libelle: a.libelle, qty: a.qty, lignes: [ligneDe(a)] });
  }

  const total = existants.concat(ajouts).reduce((s, a) => s + a.qty, 0);
  const nbArticles = existants.length + ajouts.length;
  if (c.qtyDemandee === undefined) c.qtyDemandee = Number(coin.qty) || 0;
  c.qty = total;
  if (typeof c.name === 'string') c.name = c.name.replace(/\(\d+ articles?\)/, `(${nbArticles} articles)`);
  const nbFamilles = Array.isArray(c.familles) ? c.familles.length : null;
  c.details = c.details.map((d: unknown) => {
    if (typeof d !== 'string' || lire([d]).length) return d;
    let s = d.replace(/\b\d+(\s*pièce\(s\))/, `${total}$1`).replace(/\b\d+(\s*ligne\(s\))/, `${nbArticles}$1`);
    if (nbFamilles !== null) s = s.replace(/\b\d+(\s*famille\(s\))/, `${nbFamilles}$1`);
    return s;
  });

  const date = maintenant.toISOString();
  copie.articlesAjoutes = [
    ...(Array.isArray(copie.articlesAjoutes) ? copie.articlesAjoutes : []),
    ...ajouts.map((a) => ({ ...a, admin, date })),
  ];
  copie.historique = [
    ...(Array.isArray(copie.historique) ? copie.historique : []),
    { date, admin, action: 'ajout', ajoutes: ajouts.map(ligneDe) },
  ];

  // Contrôle : le devis doit se relire avec exactement ces articles.
  const relus = articlesDuDevis(copie);
  if (!relus || relus.length !== nbArticles) {
    throw new Error("L'article n'a pas pu être ajouté au devis : rechargez la page.");
  }
  return copie;
}

/** Fichier de design d'un article AJOUTÉ (le dernier ajout de même contenu), ou undefined. */
export function fichierDeArticle(quoteData: any, a: ArticleDevis): FichierArticle | undefined {
  const liste: any[] = Array.isArray(quoteData?.articlesAjoutes) ? quoteData.articlesAjoutes : [];
  for (let i = liste.length - 1; i >= 0; i--) {
    const x = liste[i];
    if (x && x.libelle === a.libelle && (x.options || '') === a.options) {
      return x.fichier ? piecesValides([x.fichier])[0] : undefined;
    }
  }
  return undefined;
}
