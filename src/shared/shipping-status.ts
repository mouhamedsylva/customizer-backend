/**
 * Correspondance entre le suivi de production de l'atelier et le statut
 * d'exécution de Shopify.
 *
 * Les deux vocabulaires ne se recouvrent PAS entièrement :
 *
 *   Atelier            Shopify           Sens
 *   ─────────────────────────────────────────────────────────
 *   to_produce    <->  unfulfilled       les deux sens
 *   producing     <->  in_progress       les deux sens
 *   ready          ->  (aucun)           INTERNE — Shopify ne sait pas
 *                                        exprimer « fabriquée, pas encore
 *                                        expédiée »
 *   shipped       <->  fulfilled         les deux sens
 *
 * « Prête » n'a pas d'équivalent Shopify. C'est un choix assumé : l'étape est
 * utile en atelier, et la perdre appauvrirait le suivi. Elle reste donc
 * purement interne, et une commande « Prête » est vue « en préparation » par
 * Shopify (son état réel là-bas).
 */

/** Étapes du suivi de production (internes à l'atelier). */
export type ProductionStatus =
  | 'to_produce'
  | 'producing'
  | 'ready'
  | 'shipped';

/** Statut d'exécution Shopify. */
export type ShippingState =
  | 'unfulfilled'
  | 'in_progress'
  | 'partial'
  | 'fulfilled';

/** Libellés français des statuts Shopify, affichés dans le dashboard. */
export const SHIPPING_LABEL_FR: Record<ShippingState, string> = {
  unfulfilled: 'Non traitée',
  in_progress: 'En préparation',
  partial: 'Partiellement traitée',
  fulfilled: 'Traitée',
};

/**
 * Étape atelier -> statut Shopify à appliquer.
 * `null` = rien à répercuter (l'étape n'existe pas chez Shopify).
 */
export function toShopify(status: ProductionStatus): ShippingState | null {
  switch (status) {
    case 'to_produce':
      return 'unfulfilled';
    case 'producing':
      return 'in_progress';
    case 'shipped':
      return 'fulfilled';
    case 'ready':
      return null; // pas d'équivalent : reste interne
    default:
      return null;
  }
}

/**
 * Statut Shopify -> étape atelier.
 *
 * `null` = ne rien changer. C'est le cas de `in_progress` quand l'atelier est
 * déjà plus avancé : une commande marquée « Prête » chez nous ne doit pas
 * régresser en « En production » simplement parce que Shopify, lui, ne
 * distingue pas les deux. Sans cette garde, la synchro effacerait votre
 * saisie à chaque passage.
 */
export function fromShopify(
  state: ShippingState,
  current: ProductionStatus,
): ProductionStatus | null {
  switch (state) {
    case 'fulfilled':
      return current === 'shipped' ? null : 'shipped';

    case 'in_progress':
      // « Prête » et « Expédiée » sont plus avancés : on ne rétrograde pas.
      if (current === 'ready' || current === 'shipped') return null;
      return current === 'producing' ? null : 'producing';

    case 'unfulfilled':
      // Shopify n'a rien traité — mais il ignore « en production » et
      // « prête ». Son « non traitée » ne contredit donc pas un atelier plus
      // avancé : notre information est la plus riche, on la garde.
      // (Le seul cas où Shopify régresse vraiment, c'est une expédition
      // annulée ; il repasse alors la commande en unfulfilled.)
      return current === 'shipped' ? 'to_produce' : null;

    case 'partial':
      return null; // ambigu : on laisse l'atelier décider

    default:
      return null;
  }
}
