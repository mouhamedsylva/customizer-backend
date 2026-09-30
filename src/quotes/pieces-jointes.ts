/**
 * PIÈCES JOINTES DANS L'E-MAIL DE FACTURE.
 *
 * L'e-mail part par `send_invoice` de Shopify, qui n'accepte AUCUN fichier
 * joint (seulement to, subject, custom_message, bcc). Les fichiers uploadés
 * depuis la fenêtre de chiffrage n'étaient donc que mémorisés en base et posés
 * sur le brouillon en propriétés `_PièceJointe_…` — masquées au client par le
 * préfixe `_`. Le client ne recevait rien.
 *
 * On ajoute donc au message un lien de téléchargement par fichier.
 */

/** Hôte des fichiers uploadés (cloudinary.service.ts, uploadQuoteAttachment). */
const HOTE_PIECES_JOINTES = 'res.cloudinary.com';
const MAX_PIECES = 5;
const MAX_NOM = 120;

export interface PieceJointe {
  name?: unknown;
  url?: unknown;
}

/** URL acceptée dans un e-mail client : https, hôte Cloudinary uniquement.
    Les pièces viennent du corps de la requête admin : on n'y relaie pas un
    lien arbitraire. */
function urlSure(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === HOTE_PIECES_JOINTES ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Nom affiché : sur une ligne, borné. */
function nomPropre(name: unknown): string {
  const n = String(name ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return (n.length > MAX_NOM ? n.slice(0, MAX_NOM - 1) + '…' : n) || 'Document';
}

/** Pièces valides (5 au plus), dans l'ordre reçu. */
export function piecesValides(pieces: unknown): Array<{ name: string; url: string }> {
  if (!Array.isArray(pieces)) return [];
  const out: Array<{ name: string; url: string }> = [];
  for (const p of pieces as PieceJointe[]) {
    const url = p && urlSure(p.url);
    if (!url) continue;
    out.push({ name: nomPropre(p.name), url });
    if (out.length >= MAX_PIECES) break;
  }
  return out;
}

/**
 * Bloc texte à ajouter au message de la facture ; '' s'il n'y a rien à joindre.
 *
 *   Pièces jointes :
 *   - devis-detaille.pdf : https://res.cloudinary.com/…
 */
export function blocPiecesJointes(pieces: unknown): string {
  const ok = piecesValides(pieces);
  if (!ok.length) return '';
  return ['Pièces jointes :', ...ok.map((p) => `- ${p.name} : ${p.url}`)].join('\n');
}

/** Message + bloc des pièces jointes (inchangé s'il n'y en a pas). */
export function avecPiecesJointes(message: string, pieces: unknown): string {
  const bloc = blocPiecesJointes(pieces);
  if (!bloc) return message;
  return message ? `${message.replace(/\s+$/, '')}\n\n${bloc}` : bloc;
}
