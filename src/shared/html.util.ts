/**
 * Échappement HTML des données non fiables.
 *
 * Même implémentation que le `esc()` du dashboard (admin.view.ts), extraite ici
 * pour être partagée avec les templates e-mail — qui interpolaient jusqu'ici les
 * données du formulaire PUBLIC de devis sans aucun échappement (injection HTML,
 * détournement de mise en page, liens de phishing dans un e-mail de la marque).
 *
 * Échappe les cinq caractères significatifs, guillemets simples et doubles
 * compris, pour être sûr aussi bien dans un contenu que dans un attribut.
 */
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] as string,
  );
}
