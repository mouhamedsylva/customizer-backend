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
    /* Seulement un texte REDESSINÉ (police corrigée) : la planche, figée, garde
       l'ancienne police. Un texte simplement RETROUVÉ (source 'retrouve') est
       le fichier d'origine : la planche est juste. */
    Object.values(parZone as Record<string, any>).some(
      (t) => cloudinaire(t?.pngPropre) && t?.source !== 'retrouve',
    );
}

/**
 * Fichiers RATTACHÉS après coup à une ligne (`typoRetrouvee[ligne].__assets`,
 * scripts/retrouver-logos-commande) : un logo hébergé mais absent de la
 * commande. Seules les URL Cloudinary https sont retenues.
 */
/** Fichier du THÈME publié sur la boutique (drapeau FR…) : https, domaine de
    la boutique, dossier /cdn/shop/. */
const assetDuTheme = (u: unknown): u is string =>
  typeof u === 'string' && /^https:\/\/(www\.)?massacre-officiel\.com\/cdn\/shop\//.test(u);

/** « _Logo manche droite (manquant) » → « Logo manche droite » ; sinon null. */
export function logoManquant(nom: unknown): string | null {
  const m = /^_?(Logo [^()]+?)\s*\(manquant\)$/i.exec(String(nom ?? '').trim());
  return m ? m[1] : null;
}

/**
 * Propriétés d'une ligne, CORRIGÉES par `typoRetrouvee[ligne].__remplace`
 * (scripts/retrouver-logos-commande --remplacer / --retirer).
 *
 * `{ "_Logo dos": "<url>" }` remplace le fichier ; `null` masque la
 * propriété. Sert quand le thème a envoyé le MAUVAIS fichier (#20981 : deux
 * t-shirts du même produit partageaient leurs logos). La commande Shopify
 * n'est pas modifiée. Une URL qui n'est ni Cloudinary ni du thème est ignorée.
 */
export function proprietesCorrigees<P extends { name: string; value: unknown }>(
  props: P[],
  parLigne: unknown,
): P[] {
  const table = (parLigne as any)?.__remplace;
  if (!Array.isArray(props) || !table || typeof table !== 'object') return props;
  const out: P[] = [];
  for (const p of props) {
    if (!p || !Object.prototype.hasOwnProperty.call(table, p.name)) {
      out.push(p);
      continue;
    }
    const v = table[p.name];
    if (v === null) continue;
    out.push(cloudinaire(v) || assetDuTheme(v) ? { ...p, value: v } : p);
  }
  return out;
}

export function assetsRattaches(parLigne: unknown): Array<{ label: string; url: string }> {
  const liste = (parLigne as any)?.__assets;
  if (!Array.isArray(liste)) return [];
  return liste
    .filter((a: any) => a && typeof a.label === 'string' && (cloudinaire(a.url) || assetDuTheme(a.url)))
    .map((a: any) => ({ label: a.label.slice(0, 60), url: a.url }));
}

/**
 * Visuels PNG de texte rattachés après coup à une ligne qui n'a PAS de
 * propriété « _Texte … » d'origine (texte perdu par l'ancien thème, retrouvé
 * sur Cloudinary par scripts/retrouver-logos-commande).
 */
export function pngRegeneresSansOrigine(
  parZone: unknown,
  nomsProprietes: unknown[],
): Array<{ zone: string; libelle: string; url: string }> {
  if (!parZone || typeof parZone !== 'object') return [];
  const presentes = new Set(nomsProprietes.map((n) => zoneDuPng(n)).filter(Boolean));
  const LIBELLES: Record<string, string> = { f: 'Texte face', fr: 'Texte poitrine droite', b: 'Texte dos' };
  return Object.keys(LIBELLES)
    .filter((z) => !presentes.has(z) && cloudinaire((parZone as any)[z]?.pngPropre))
    .map((z) => ({ zone: z, libelle: `${LIBELLES[z]} (retrouvé)`, url: (parZone as any)[z].pngPropre }));
}

/** Zone d'un fichier texte d'après son nom (text_chest-right_<ms>…). */
export function zoneDuFichierTexte(url: unknown): string | null {
  const m = /text_(front|chest-right|back)_\d+/.exec(String(url ?? ''));
  return m ? ({ front: 'f', 'chest-right': 'fr', back: 'b' } as Record<string, string>)[m[1]] : null;
}
