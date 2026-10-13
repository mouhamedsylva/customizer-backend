/**
 * FAMILLE D'ARTICLE d'une commande, pour le filtre « par article » du
 * dashboard (Patchs / Textiles / Coins / Drapeaux).
 *
 * Seuls les TITRES de ligne sont lus — ceux que voit l'atelier — et non le
 * nommage interne du thème (où `coins` et `patches` sont inversés). Titres
 * rencontrés :
 *   - achat direct : « Textile - Sweatshirt », « Textile - T-shirt Coton »,
 *     « Patch personnalisé », « Coin métal personnalisé », « Drapeau
 *     personnalisé », « Personnalisation manche » (supplément textile) ;
 *   - devis : « Patchs personnalisés », « Coins métal personnalisés »,
 *     « Sweatshirts personnalisés »… (conf-cart-quote.js, LIBELLE_FAMILLE),
 *     « Textile — M / Noir » (groupe), « Commande de patchs (30 pièces) ».
 */
export type FamilleArticle = 'patchs' | 'textiles' | 'coins' | 'drapeaux';

export const FAMILLES_ARTICLES: ReadonlyArray<{ cle: FamilleArticle; libelle: string }> = [
  { cle: 'patchs', libelle: 'Patchs' },
  { cle: 'textiles', libelle: 'Textiles' },
  { cle: 'coins', libelle: 'Coins' },
  { cle: 'drapeaux', libelle: 'Drapeaux' },
];

/** Minuscules, sans accents. */
const normaliser = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Famille d'une ligne d'après son titre ; null si non reconnue. */
export function familleDeLigne(titre: unknown): FamilleArticle | null {
  const t = normaliser(titre);
  if (!t) return null;
  // Ordre : « coin » avant « patch » n'importe pas (aucun titre ne porte les deux).
  if (/\bpatch/.test(t)) return 'patchs';
  if (/\bcoin/.test(t)) return 'coins';
  if (/\bdrapeau|\bflag/.test(t)) return 'drapeaux';
  if (/\btextile|t-?shirt|\bsweat|\bhoodie|\bpolo|\bmanche/.test(t)) return 'textiles';
  return null;
}

/**
 * Familles présentes dans une commande, sans doublon, dans l'ordre du filtre.
 * Une commande mixte (patch + t-shirt) figure dans chaque filtre concerné.
 * Aucune ligne reconnue : ['autre'].
 */
export function famillesDeCommande(lignes: unknown): string[] {
  const trouvees = new Set<string>();
  for (const li of Array.isArray(lignes) ? lignes : []) {
    const f = familleDeLigne((li as any)?.title);
    if (f) trouvees.add(f);
  }
  const ordre = FAMILLES_ARTICLES.map((f) => f.cle).filter((c) => trouvees.has(c));
  return ordre.length ? ordre : ['autre'];
}
