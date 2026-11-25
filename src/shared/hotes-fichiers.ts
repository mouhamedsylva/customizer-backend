/**
 * HÔTES DES FICHIERS STOCKÉS — la seule liste à tenir à jour.
 *
 * Deux stockages coexistent depuis la bascule vers OVHcloud Object Storage :
 *   - Cloudinary (`res.cloudinary.com`) : TOUS les fichiers d'avant la bascule,
 *     dont les liens sont écrits dans les commandes Shopify, la base et les
 *     e-mails déjà envoyés — ils doivent rester acceptés indéfiniment ;
 *   - OVH (`OVH_S3_URL_PUBLIQUE`, ex. massacre-fichiers.s3.gra.io.cloud.ovh.net)
 *     : les fichiers envoyés depuis la bascule.
 *
 * Utilisée par la CSP (main.ts), les vignettes du dashboard (IMG_HOSTS), le
 * ZIP de production (ASSET_HOSTS), la garde SSRF (cloudinary.service.ts), les
 * liens des e-mails (pieces-jointes.ts), le formulaire de devis et les scripts.
 * L'hôte OVH est lu À CHAQUE APPEL dans l'environnement : les modules qui
 * importent cette liste sont chargés avant ConfigModule.
 */

export const HOTE_CLOUDINARY = 'res.cloudinary.com';

/** Hôte public du bucket OVH, en minuscules ; '' s'il n'est pas configuré. */
export function hoteOvh(): string {
  const brut = String(process.env.OVH_S3_URL_PUBLIQUE || '').trim();
  if (!brut) return '';
  try {
    const u = new URL(brut);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

/** URL publique de base du bucket OVH, sans « / » final ; '' si absente. */
export function urlPubliqueOvh(): string {
  return hoteOvh() ? String(process.env.OVH_S3_URL_PUBLIQUE).trim().replace(/\/+$/, '') : '';
}

/** Hôtes des fichiers stockés : Cloudinary, plus OVH s'il est configuré. */
export function hotesFichiers(): string[] {
  const ovh = hoteOvh();
  return ovh ? [HOTE_CLOUDINARY, ovh] : [HOTE_CLOUDINARY];
}

/** Vrai si `url` désigne le bucket OVH (https, hôte EXACT). */
export function estUrlOvh(url: unknown): url is string {
  const ovh = hoteOvh();
  if (!ovh || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.toLowerCase() === ovh;
  } catch {
    return false;
  }
}

/**
 * Vrai si `url` est un fichier de NOS stockages : https, hôte EXACT
 * (Cloudinary ou bucket OVH — jamais un sous-domaine voisin), sans espace ni
 * caractère qui casserait un attribut HTML.
 */
export function estUrlFichierStocke(url: unknown): url is string {
  if (typeof url !== 'string' || /[\s"'<>]/.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hotesFichiers().includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Clé d'un fichier OVH depuis son URL publique, ou null (autre hôte, URL
 * illisible). Décodée (%20…) ; les « .. » sont refusés.
 */
export function cleOvhDepuisUrl(url: unknown): string | null {
  if (!estUrlOvh(url)) return null;
  let cle: string;
  try {
    cle = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
  if (!cle || cle.split('/').includes('..')) return null;
  return cle;
}
