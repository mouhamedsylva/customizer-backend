/**
 * CHIFFRAGE EN COURS d'un devis : ce que l'admin a saisi dans la fenêtre de
 * chiffrage SANS avoir encore envoyé la facture (prix, quantités, retraits,
 * articles ajoutés et leur design).
 *
 * Enregistré automatiquement dans `quoteData.chiffrageEnCours`, à part des
 * vrais articles : le devis, son brouillon Shopify et la fiche de production
 * ne changent qu'à l'ENVOI de la facture (qui efface ensuite ce brouillon).
 * Il ne sert qu'à pré-remplir la fenêtre, pour tous les admins.
 */
import { validerArticlesAjoutes, type ArticleAjoute } from './ajout-articles';
import { quantiteValide } from './articles-devis';

/** Au-delà, le navigateur envoie n'importe quoi : refusé. */
const MAX_LIGNES = 300;

export interface LigneEnCours {
  qty: number;
  /** Prix tel que saisi dans le champ ('' si vide). */
  valeur: string;
  retire: boolean;
}

export interface ChiffrageEnCours {
  /** Une entrée par article D'ORIGINE, dans l'ordre de la fenêtre. */
  lignes: LigneEnCours[];
  ajouts: Array<ArticleAjoute & { valeur: string }>;
  admin: string;
  date: string;
}

/** Prix saisi : chaîne vide, ou nombre positif à 2 décimales au plus. */
function valeurPrix(v: unknown): string | null {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return '';
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 1e7 ? String(Math.round(n * 100) / 100) : null;
}

/** Corps reçu du navigateur → chiffrage propre, ou une erreur. null = effacer. */
export function lireChiffrageEnCours(
  brut: unknown,
  admin: string,
  maintenant: Date = new Date(),
): { chiffrage: ChiffrageEnCours | null } | { erreur: string } {
  if (brut === null || brut === undefined) return { chiffrage: null };
  if (typeof brut !== 'object') return { erreur: 'Chiffrage illisible.' };
  const b = brut as Record<string, unknown>;
  const lignesBrutes = Array.isArray(b.lignes) ? b.lignes : [];
  const ajoutsBruts = Array.isArray(b.ajouts) ? b.ajouts : [];
  if (lignesBrutes.length > MAX_LIGNES) return { erreur: 'Chiffrage trop long.' };

  const lignes: LigneEnCours[] = [];
  for (const l of lignesBrutes as Array<Record<string, unknown>>) {
    const qty = Number(l?.qty);
    const valeur = valeurPrix(l?.valeur);
    if (!quantiteValide(qty) || valeur === null) return { erreur: 'Chiffrage illisible (quantité ou prix).' };
    lignes.push({ qty, valeur, retire: l?.retire === true });
  }

  const v = validerArticlesAjoutes(ajoutsBruts);
  if ('erreur' in v) return { erreur: v.erreur };
  const ajouts: ChiffrageEnCours['ajouts'] = [];
  for (let i = 0; i < v.articles.length; i++) {
    const valeur = valeurPrix((ajoutsBruts[i] as Record<string, unknown>)?.valeur);
    if (valeur === null) return { erreur: 'Prix illisible pour un article ajouté.' };
    ajouts.push({ ...v.articles[i], valeur });
  }

  if (!lignes.length && !ajouts.length) return { chiffrage: null };
  return { chiffrage: { lignes, ajouts, admin, date: maintenant.toISOString() } };
}
