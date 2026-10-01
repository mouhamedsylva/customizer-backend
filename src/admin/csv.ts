/**
 * Cellule CSV sûre pour Excel / LibreOffice.
 *
 * Les champs viennent en partie du formulaire PUBLIC de devis (nom, entreprise,
 * message…). Une valeur commençant par `=`, `+`, `-`, `@`, une tabulation ou
 * un retour chariot est interprétée comme une FORMULE à l'ouverture du
 * fichier : `=HYPERLINK("https://…","Cliquez")`, voire une commande DDE,
 * s'exécutait chez le comptable. Préfixer d'une apostrophe la neutralise
 * (Excel l'affiche comme du texte, sans l'apostrophe).
 */
export function celluleCsv(v: unknown): string {
  let s = String(v ?? '');
  // Un nombre (montant négatif compris) reste un nombre pour le tableur.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(?:[.,]\d+)?$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Libellé de période sûr pour un nom de fichier (en-tête Content-Disposition). */
export function periodeFichier(p: unknown): string {
  return String(p ?? 'all').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'all';
}
