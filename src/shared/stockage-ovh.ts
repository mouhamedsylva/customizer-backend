/**
 * STOCKAGE OVHcloud Object Storage (API S3) — remplaçant de Cloudinary.
 *
 * Utilisé par CloudinaryService (cloudinary.service.ts) : quand
 * `STOCKAGE_FOURNISSEUR=ovh`, l'étape d'ENVOI y est aiguillée ; le reste
 * (sharp, compositions, SVG) ne change pas. Retour arrière : remettre
 * `cloudinary` et redémarrer.
 *
 * Fichiers PUBLICS par leur lien, comme sur Cloudinary : OVH refuse les
 * politiques de bucket (`PutBucketPolicy`), chaque objet est donc envoyé avec
 * l'ACL `public-read`. Le listage du bucket reste interdit (403). Les noms
 * portent un suffixe aléatoire : un fichier public ne doit pas se deviner.
 *
 * Le `publicId` renvoyé est préfixé `ovh:` : c'est lui qui aiguille ensuite
 * suppression et téléchargement vers OVH, même après un retour à Cloudinary.
 */
import { randomBytes } from 'crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { urlPubliqueOvh } from './hotes-fichiers';

export const PREFIXE_OVH = 'ovh:';

/** Plafond de lecture d'un fichier (même borne que lireCorpsBorne). */
const LECTURE_MAX = 15 * 1024 * 1024;

/** Lecteur de configuration : ConfigService.get, ou process.env dans les scripts. */
export type LireConfig = (cle: string) => string | undefined;

/** Type de contenu par extension (fichiers envoyés tels quels). */
const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain; charset=utf-8',
};

/** Extension par type MIME (images sans extension dans leur nom). */
const EXT_IMAGE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function typeDepuisExtension(nomOuCle: string): string {
  const ext = (String(nomOuCle).match(/\.([a-z0-9]{1,5})$/i) || [])[1]?.toLowerCase() || '';
  return TYPES[ext] || 'application/octet-stream';
}

export function extensionImage(mimetype: string): string {
  return EXT_IMAGE[String(mimetype || '').toLowerCase()] || 'bin';
}

/** Documents Office et texte : téléchargés plutôt qu'affichés par le navigateur. */
function enTelechargement(type: string): boolean {
  return !/^(image\/|application\/pdf)/.test(type);
}

/** `ovh:<clé>` → `<clé>` ; null si le publicId n'est pas un fichier OVH. */
export function cleDuPublicId(publicId: unknown): string | null {
  const s = String(publicId ?? '');
  if (!s.startsWith(PREFIXE_OVH)) return null;
  const cle = s.slice(PREFIXE_OVH.length).replace(/^\/+/, '');
  return cle && !cle.split('/').includes('..') ? cle : null;
}

export class StockageOvh {
  private client: S3Client | null = null;

  constructor(private readonly lire: LireConfig) {}

  /** Vrai si les NOUVEAUX fichiers doivent partir vers OVH. */
  actif(): boolean {
    return String(this.lire('STOCKAGE_FOURNISSEUR') || '').trim().toLowerCase() === 'ovh';
  }

  private bucket(): string {
    const b = String(this.lire('OVH_S3_BUCKET') || '').trim();
    if (!b) throw new Error('OVH_S3_BUCKET manquant : stockage OVH non configuré.');
    return b;
  }

  /** Client S3 créé à la première utilisation (aucune connexion au démarrage). */
  private s3(): S3Client {
    if (this.client) return this.client;
    const endpoint = String(this.lire('OVH_S3_ENDPOINT') || '').trim();
    const accessKeyId = String(this.lire('OVH_S3_ACCESS_KEY') || '').trim();
    const secretAccessKey = String(this.lire('OVH_S3_SECRET_KEY') || '').trim();
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('OVH_S3_ENDPOINT / OVH_S3_ACCESS_KEY / OVH_S3_SECRET_KEY manquants.');
    }
    this.client = new S3Client({
      endpoint,
      region: String(this.lire('OVH_S3_REGION') || 'gra').trim(),
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: false,
    });
    return this.client;
  }

  /** Remplace le client (tests). */
  utiliserClient(client: S3Client): void {
    this.client = client;
  }

  /**
   * Clé unique : `<dossier>/<base>_<horodatage>-<8 hex>.<ext>`. La base est
   * réduite à des caractères sûrs (elle vient souvent d'un nom de fichier client).
   */
  cleUnique(dossier: string, base: string, ext: string): string {
    const propre = (s: string) => String(s || '').replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^[.-]+/, '');
    const d = String(dossier || 'customizer')
      .split('/')
      .map(propre)
      .filter(Boolean)
      .join('/');
    const b = (propre(base).replace(/\.+$/, '') || 'fichier').slice(0, 80);
    const e = propre(ext).replace(/^\.+/, '').toLowerCase() || 'bin';
    return `${d}/${b}_${Date.now()}-${randomBytes(4).toString('hex')}.${e}`;
  }

  /** URL publique d'une clé (segments encodés). */
  urlDe(cle: string): string {
    const base = urlPubliqueOvh();
    if (!base) throw new Error('OVH_S3_URL_PUBLIQUE manquant ou invalide (https attendu).');
    return `${base}/${cle.split('/').map(encodeURIComponent).join('/')}`;
  }

  /** Envoie un fichier en lecture publique ; renvoie son URL et son publicId `ovh:`. */
  async envoyer(
    buffer: Buffer,
    cle: string,
    contentType = typeDepuisExtension(cle),
  ): Promise<{ url: string; publicId: string; bytes: number }> {
    const nom = cle.split('/').pop() || 'fichier';
    await this.s3().send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: cle,
        Body: buffer,
        ContentType: contentType,
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000, immutable',
        ...(enTelechargement(contentType) ? { ContentDisposition: `attachment; filename="${nom}"` } : {}),
      }),
    );
    return { url: this.urlDe(cle), publicId: PREFIXE_OVH + cle, bytes: buffer.length };
  }

  /** Lit un fichier (15 Mo au plus). */
  async lireFichier(cle: string): Promise<Buffer> {
    const r = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket(), Key: cle }));
    if (r.ContentLength && r.ContentLength > LECTURE_MAX) {
      throw new Error(`Fichier trop volumineux (${r.ContentLength} octets).`);
    }
    const corps = r.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    if (!corps?.transformToByteArray) throw new Error('Réponse OVH sans contenu.');
    const octets = await corps.transformToByteArray();
    if (octets.length > LECTURE_MAX) throw new Error('Fichier trop volumineux.');
    return Buffer.from(octets);
  }

  /** Supprime un fichier ; un fichier déjà absent n'est pas une erreur (S3 répond 204). */
  async supprimer(cle: string): Promise<void> {
    await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: cle }));
  }
}
