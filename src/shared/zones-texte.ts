/**
 * Propriétés « … (SVG) » d'une ligne de commande : le fichier de découpe d'un
 * texte, par zone. Libellés posés par le thème (`collectTextAssets`,
 * conf-main-inline.js) : « _Texte face (SVG) », « _Texte dos (SVG) »…
 */
export const ZONES_TEXTE: Readonly<Record<string, string>> = {
  'texte face': 'f',
  'texte poitrine droite': 'fr',
  'texte dos': 'b',
};

/** « _Texte face (SVG) » → 'f' ; toute autre propriété → null. */
export function zoneDuSvg(nom: unknown): string | null {
  const m = /^_?(.+?)\s*\(SVG\)$/i.exec(String(nom ?? '').trim());
  return m ? ZONES_TEXTE[m[1].toLowerCase()] ?? null : null;
}

/**
 * URL du SVG RÉGÉNÉRÉ qui remplace ce fichier de découpe, s'il existe.
 *
 * Les SVG produits avant septembre 2026 pouvaient contenir des `NaN` (lettres
 * perdues à la découpe). `scripts/verifier-svg-commandes` en régénère un
 * propre et le range dans `Order.typoRetrouvee[ligne][zone].svgPropre` — sans
 * toucher à la commande Shopify. Dashboard et archive ZIP le servent à la
 * place de l'original.
 */
export function svgRegenere(parZone: unknown, nomPropriete: unknown): string | null {
  const zone = zoneDuSvg(nomPropriete);
  const url = zone ? (parZone as any)?.[zone]?.svgPropre : null;
  return typeof url === 'string' && /^https:\/\/res\.cloudinary\.com\//.test(url) ? url : null;
}
