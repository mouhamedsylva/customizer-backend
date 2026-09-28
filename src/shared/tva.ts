/**
 * Calcul de TVA de la fenêtre de chiffrage des devis — SOURCE UNIQUE.
 *
 * Ces fonctions vivaient dans le script de la page (admin.view.ts) : ni
 * typées, ni testables. Elles sont désormais définies ici, testées
 * (test/tva.spec.ts), et injectées TELLES QUELLES dans la page par
 * `scriptTva()`. Le navigateur exécute donc exactement le code testé.
 *
 * ⚠ Contraintes de l'injection (`String(fonction)`) : fonctions AUTONOMES —
 * aucune importation, aucune variable du module, seulement des appels entre
 * elles. Pas de gabarit `${…}` ni d'accent grave dans leur corps : elles
 * finissent dans un gabarit TypeScript.
 */

export interface ReglagesTva {
  /** Taux appliqué par Shopify (0,2 = 20 %), ou null s'il est encore inconnu. */
  rate: number | null;
  /** Boutique en prix taxes incluses ; null = pas encore lu (traité comme vrai). */
  taxesIncluded: boolean | null;
  /** Client exonéré : aucune TVA facturée. */
  taxExempt: boolean;
}

/** Taux supposé tant que Shopify n'a calculé aucune taxe (brouillon à 0 €). */
export const TVA_TAUX_DEFAUT = 0.2;

export function arrondiTva(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Taux à appliquer : 0 pour un client exonéré, 20 % supposés si inconnu. */
export function tauxTva(cfg: ReglagesTva): number {
  if (cfg.taxExempt) return 0;
  return cfg.rate === null || cfg.rate === undefined ? 0.2 : cfg.rate;
}

/** Vrai quand Shopify attend des prix TTC : le HT saisi est alors converti. */
export function envoiEnTtc(cfg: ReglagesTva): boolean {
  return !cfg.taxExempt && cfg.taxesIncluded !== false;
}

/**
 * Prix UNITAIRE transmis à Shopify pour un prix unitaire HT saisi. Arrondi au
 * centime : Shopify n'accepte qu'un prix au centime par ligne et facture
 * prix × quantité, c'est donc ce prix arrondi qui fixe le total payé.
 */
export function prixUnitaireEnvoye(unitHt: number, cfg: ReglagesTva): number {
  return envoiEnTtc(cfg) ? arrondiTva(unitHt * (1 + tauxTva(cfg))) : unitHt;
}

/**
 * Total TTC que paiera le client pour un prix unitaire HT × quantité. En
 * boutique TTC, il découle du prix unitaire ARRONDI envoyé : c'est exactement
 * ce que Shopify facturera, au centime près.
 */
export function ttcLigne(unitHt: number, qty: number, cfg: ReglagesTva): number {
  if (envoiEnTtc(cfg)) return prixUnitaireEnvoye(unitHt, cfg) * qty;
  return arrondiTva(unitHt * qty * (1 + tauxTva(cfg)));
}

/** Le code des fonctions ci-dessus, prêt à être inséré dans un <script>. */
export function scriptTva(): string {
  return [arrondiTva, tauxTva, envoiEnTtc, prixUnitaireEnvoye, ttcLigne]
    .map((f) => String(f))
    .join('\n');
}
