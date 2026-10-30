/**
 * Autorisation de publier les photos de la commande sur les réseaux sociaux.
 *
 * Posée par la page récapitulatif du thème en ATTRIBUT DE PANIER
 * (« Autorisation photos réseaux sociaux » = « Oui » | « Non »), elle arrive
 * dans la commande Shopify sous `note_attributes`. Rangée dans
 * `Order.customerInfo.photos`, affichée sur la carte et la fiche de production.
 */
export type AutorisationPhotos = 'oui' | 'non' | null;

const sansAccents = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Lit la réponse dans les `note_attributes` d'une commande ; null si absente. */
export function autorisationPhotos(noteAttributes: unknown): AutorisationPhotos {
  if (!Array.isArray(noteAttributes)) return null;
  for (const a of noteAttributes) {
    const nom = sansAccents(String(a?.name ?? ''));
    if (!/photo/.test(nom) || !/(autoris|reseau)/.test(nom)) continue;
    const v = sansAccents(String(a?.value ?? ''));
    if (v.startsWith('oui')) return 'oui';
    if (v.startsWith('non')) return 'non';
  }
  return null;
}
