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

/** « _Texte face » (le visuel PNG du texte) → 'f' ; toute autre propriété → null. */
export function zoneDuPng(nom: unknown): string | null {
  const m = /^_?(texte face|texte poitrine droite|texte dos)$/i.exec(String(nom ?? '').trim());
  return m ? ZONES_TEXTE[m[1].toLowerCase()] ?? null : null;
}

const cloudinaire = (u: unknown): u is string =>
  typeof u === 'string' && /^https:\/\/res\.cloudinary\.com\//.test(u);

/**
 * Visuel PNG RÉGÉNÉRÉ qui remplace ce visuel de texte, s'il existe.
 *
 * Avant le 27/09/2026, le PNG du texte était dessiné avec la police par défaut
 * du serveur (la police choisie n'y était pas installée) : « Courgette »
 * sortait en sans-serif. `scripts/corriger-texte-commande` le redessine dans la
 * vraie police et le range dans `typoRetrouvee[ligne][zone].pngPropre`.
 */
export function pngRegenere(parZone: unknown, nomPropriete: unknown): string | null {
  const zone = zoneDuPng(nomPropriete);
  const url = zone ? (parZone as any)?.[zone]?.pngPropre : null;
  return cloudinaire(url) ? url : null;
}

/**
 * Fichiers de découpe régénérés d'une ligne qui N'ONT PAS de propriété
 * « (SVG) » d'origine (le SVG n'avait pas pu être produit) : sans cela, ils
 * seraient invisibles dans le dashboard et absents de l'archive.
 */
export function svgRegeneresSansOrigine(
  parZone: unknown,
  nomsProprietes: unknown[],
): Array<{ zone: string; libelle: string; url: string }> {
  if (!parZone || typeof parZone !== 'object') return [];
  const presentes = new Set(nomsProprietes.map((n) => zoneDuSvg(n)).filter(Boolean));
  const LIBELLES: Record<string, string> = { f: 'Texte face', fr: 'Texte poitrine droite', b: 'Texte dos' };
  return Object.keys(LIBELLES)
    .filter((z) => !presentes.has(z) && cloudinaire((parZone as any)[z]?.svgPropre))
    .map((z) => ({ zone: z, libelle: `${LIBELLES[z]} (SVG)`, url: (parZone as any)[z].svgPropre }));
}

/** La ligne a-t-elle un visuel de texte régénéré (donc une planche d'aperçu périmée) ? */
export function aDesTextesRegeneres(parZone: unknown): boolean {
  return !!parZone && typeof parZone === 'object' &&
    Object.values(parZone as Record<string, any>).some((t) => cloudinaire(t?.pngPropre));
}
