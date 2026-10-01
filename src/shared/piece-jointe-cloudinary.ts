/**
 * PIÈCES JOINTES DE FACTURE SUR CLOUDINARY — documents gardés en documents.
 *
 * En `resource_type: 'auto'`, Cloudinary rangeait le PDF parmi les IMAGES
 * (`…/image/upload/….pdf`) : traité comme une image, et bloqué à la livraison
 * sur un compte récent (401). DOC et XLS passaient en `raw`, mais sans
 * extension dans le `public_id` : le client téléchargeait un fichier sans
 * extension, de type générique.
 *
 * Désormais : image → `image` ; tout autre document → `raw` AVEC son
 * extension. Cloudinary le sert alors octet pour octet, sous son vrai type.
 */

export type TypeRessource = 'image' | 'raw';

/** Extension par type, si le nom d'origine n'en porte pas. */
const EXT_PAR_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
};

/** Options d'upload : type de ressource et public_id (sans le dossier). */
export function optionsPieceJointe(
  nomOriginal: string,
  mimetype: string,
  horodatage: number = Date.now(),
): { resourceType: TypeRessource; publicId: string } {
  const nom = String(nomOriginal || '');
  const base =
    nom
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 60) || 'attachment';
  const type = String(mimetype || '').toLowerCase();

  if (type.startsWith('image/')) {
    return { resourceType: 'image', publicId: `${base}_${horodatage}` };
  }
  const extNom = (nom.match(/\.([a-zA-Z0-9]{1,5})$/) || [])[1];
  const ext = (extNom || EXT_PAR_TYPE[type] || 'bin').toLowerCase();
  return { resourceType: 'raw', publicId: `${base}_${horodatage}.${ext}` };
}

/**
 * public_id et type de ressource depuis une URL de livraison Cloudinary.
 * En `raw`, l'extension FAIT PARTIE du public_id ; en `image`, non.
 */
export function ressourceDepuisUrl(
  url: string,
  cloudName?: string,
): { publicId: string; resourceType: TypeRessource } | null {
  /* Hôte ET compte vérifiés : l'URL vient d'une requête admin, et le
     nettoyage supprime ce qu'elle désigne. Sans ce contrôle, une URL forgée
     faisait supprimer n'importe quel fichier du compte. */
  let u: URL;
  try {
    u = new URL(String(url || ''));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'res.cloudinary.com') return null;
  if (cloudName && u.pathname.split('/')[1] !== cloudName) return null;
  const m = u.pathname.match(/\/(image|raw)\/upload\/(?:v\d+\/)?(.+)$/i);
  if (!m) return null;
  const resourceType = m[1].toLowerCase() as TypeRessource;
  // URL fournie par une requête admin : un échappement invalide (%zz) faisait
  // lever decodeURIComponent et arrêtait TOUTE la passe de nettoyage.
  let chemin: string;
  try {
    chemin = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  /* Seul le dossier des pièces jointes est supprimable : une URL pointant un
     logo ou un SVG de commande de notre compte ne doit jamais être détruite. */
  if (!chemin.startsWith('customizer/temp-attachments/')) return null;
  if (resourceType === 'raw') return { publicId: chemin, resourceType };
  const sansExt = chemin.replace(/\.[a-zA-Z0-9]{1,5}$/, '');
  return sansExt ? { publicId: sansExt, resourceType } : null;
}
