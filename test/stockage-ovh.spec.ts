import sharp from 'sharp';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { CloudinaryService } from '../src/shared/cloudinary.service';
import { cleDuPublicId, StockageOvh } from '../src/shared/stockage-ovh';
import { cleOvhDepuisUrl, estUrlFichierStocke, hoteOvh } from '../src/shared/hotes-fichiers';
import { ressourceDepuisUrl } from '../src/shared/piece-jointe-cloudinary';
import { ressourceCommande } from '../src/admin/commandes-manuelles';
import { verifierEnv } from '../src/config/verifier-env';

const HOTE = 'massacre-fichiers.s3.gra.io.cloud.ovh.net';
const BASE = `https://${HOTE}`;

const ENV: Record<string, string> = {
  STOCKAGE_FOURNISSEUR: 'ovh',
  OVH_S3_ENDPOINT: 'https://s3.gra.io.cloud.ovh.net',
  OVH_S3_REGION: 'gra',
  OVH_S3_BUCKET: 'massacre-fichiers',
  OVH_S3_ACCESS_KEY: 'ak',
  OVH_S3_SECRET_KEY: 'sk',
  OVH_S3_URL_PUBLIQUE: BASE,
};

let avant: string | undefined;
beforeAll(() => {
  avant = process.env.OVH_S3_URL_PUBLIQUE;
  process.env.OVH_S3_URL_PUBLIQUE = BASE;
});
afterAll(() => {
  if (avant === undefined) delete process.env.OVH_S3_URL_PUBLIQUE;
  else process.env.OVH_S3_URL_PUBLIQUE = avant;
});

/** Client S3 simulé : garde chaque commande envoyée. */
function faux() {
  const envoyes: any[] = [];
  const client = {
    send: jest.fn(async (cmd: any) => {
      envoyes.push(cmd);
      if (cmd instanceof GetObjectCommand) {
        return { ContentLength: 3, Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
      }
      return {};
    }),
  };
  return { client: client as any, envoyes };
}

function service(env: Record<string, string> = ENV) {
  const s = new CloudinaryService({ get: (k: string) => env[k] } as any);
  const f = faux();
  ((s as any).ovh as StockageOvh).utiliserClient(f.client);
  return { s, envoyes: f.envoyes };
}

describe('hotes-fichiers', () => {
  it('accepte Cloudinary et le bucket OVH, hôte exact et https seulement', () => {
    expect(hoteOvh()).toBe(HOTE);
    expect(estUrlFichierStocke(`${BASE}/customizer/logos/x.png`)).toBe(true);
    expect(estUrlFichierStocke('https://res.cloudinary.com/demo/image/upload/x.png')).toBe(true);
    expect(estUrlFichierStocke(`http://${HOTE}/x.png`)).toBe(false);
    expect(estUrlFichierStocke('https://evil.s3.gra.io.cloud.ovh.net/x.png')).toBe(false);
    expect(estUrlFichierStocke(`https://x.${HOTE}/x.png`)).toBe(false);
    expect(estUrlFichierStocke(`${BASE}/x.png" onerror="1`)).toBe(false);
  });

  it('lit la clé d’une URL OVH et refuse les « .. »', () => {
    expect(cleOvhDepuisUrl(`${BASE}/customizer/a%20b.png`)).toBe('customizer/a b.png');
    // « .. » encodé : normalisé par l'URL (→ « secret »), puis refusé par la garde de dossier.
    expect(cleOvhDepuisUrl(`${BASE}/customizer/temp-attachments/%2E%2E/%2E%2E/secret`)).toBe('secret');
    expect(ressourceDepuisUrl(`${BASE}/customizer/temp-attachments/%2E%2E/%2E%2E/secret`)).toBeNull();
    expect(cleOvhDepuisUrl('https://res.cloudinary.com/demo/x.png')).toBeNull();
  });
});

describe('CloudinaryService avec STOCKAGE_FOURNISSEUR=ovh', () => {
  it('envoie un logo en public-read, avec son type, une clé unique et un publicId ovh:', async () => {
    const { s, envoyes } = service();
    const png = await sharp({ create: { width: 40, height: 20, channels: 4, background: '#f00' } }).png().toBuffer();
    const r = await s.uploadLogo(png, 'generic', 'front');
    const put = envoyes[0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({ Bucket: 'massacre-fichiers', ACL: 'public-read', ContentType: 'image/png' });
    expect(put.input.Key).toMatch(/^customizer\/logos\/generic\/logo_front_\d+_\d+-[0-9a-f]{8}\.png$/);
    expect(put.input.ContentDisposition).toBeUndefined();
    expect(r.url).toBe(`${BASE}/${put.input.Key}`);
    expect(r.publicId).toBe(`ovh:${put.input.Key}`);
    expect([r.width, r.height]).toEqual([40, 20]);
  });

  it('SVG de découpe : image/svg+xml, dimensions lues dans le SVG', async () => {
    const { s, envoyes } = service();
    const r = await s.uploadTextSvgVector('<svg width="120" height="30" xmlns="http://www.w3.org/2000/svg"/>', 'tshirt', 'back');
    expect(envoyes[0].input.ContentType).toBe('image/svg+xml');
    expect(envoyes[0].input.Key).toMatch(/^customizer\/text\/tshirt\/text_back_\d+-[0-9a-f]{8}\.svg$/);
    expect([r.width, r.height, r.format]).toEqual([120, 30, 'svg']);
  });

  it('pièce jointe Office : téléchargée (Content-Disposition), dans temp-attachments', async () => {
    const { s, envoyes } = service();
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    await s.uploadQuoteAttachment(Buffer.from('x'), 'Devis signé.docx', mime);
    expect(envoyes[0].input.Key).toMatch(/^customizer\/temp-attachments\/Devis-sign-_\d+_\d+-[0-9a-f]{8}\.docx$/);
    expect(envoyes[0].input.ContentType).toBe(mime);
    expect(envoyes[0].input.ContentDisposition).toMatch(/^attachment;/);
  });

  it('fichier de commande image : extension déduite du type', async () => {
    const { s, envoyes } = service();
    const r = await s.uploadFichierCommande(Buffer.from('x'), 'bat', 'image/jpeg', 'devis-abc');
    expect(envoyes[0].input.Key).toMatch(/^customizer\/commandes\/devis-abc\/bat_\d+_\d+-[0-9a-f]{8}\.jpg$/);
    expect(r.resourceType).toBe('image');
  });

  it('suppression et lecture aiguillées par le préfixe ovh:, même revenu à Cloudinary', async () => {
    const { s, envoyes } = service({ ...ENV, STOCKAGE_FOURNISSEUR: 'cloudinary' });
    await s.deleteResource('ovh:customizer/temp-attachments/a.pdf', 'raw');
    expect(envoyes[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(envoyes[0].input.Key).toBe('customizer/temp-attachments/a.pdf');
    expect(await s.telechargerFichier('ovh:customizer/commandes/1/a.pdf', 'raw')).toEqual(Buffer.from([1, 2, 3]));
    expect(await s.deleteImage('ovh:customizer/logos/x.png')).toBe(true);
  });

  it('reste sur Cloudinary quand STOCKAGE_FOURNISSEUR=cloudinary (aucun envoi OVH)', () => {
    const { s } = service({ ...ENV, STOCKAGE_FOURNISSEUR: 'cloudinary' });
    expect(((s as any).ovh as StockageOvh).actif()).toBe(false);
  });
});

describe('lecture des URL OVH pour le nettoyage et les commandes manuelles', () => {
  it('pièce jointe : publicId ovh:, seulement dans temp-attachments', () => {
    expect(ressourceDepuisUrl(`${BASE}/customizer/temp-attachments/devis_1-ab.pdf`, 'demo')).toEqual({
      publicId: 'ovh:customizer/temp-attachments/devis_1-ab.pdf',
      resourceType: 'raw',
    });
    expect(ressourceDepuisUrl(`${BASE}/customizer/logos/generic/logo.png`, 'demo')).toBeNull();
  });

  it('commande manuelle : publicId ovh:, seulement dans commandes', () => {
    expect(ressourceCommande(`${BASE}/customizer/commandes/M-12/bat_1-ab.png`)).toEqual({
      publicId: 'ovh:customizer/commandes/M-12/bat_1-ab.png',
      resourceType: 'image',
    });
    expect(ressourceCommande(`${BASE}/customizer/temp-attachments/x.pdf`)).toBeNull();
  });

  it('cleDuPublicId : refuse un publicId Cloudinary ou un « .. »', () => {
    expect(cleDuPublicId('customizer/logos/x')).toBeNull();
    expect(cleDuPublicId('ovh:customizer/../x')).toBeNull();
    expect(cleDuPublicId('ovh:customizer/x.png')).toBe('customizer/x.png');
  });
});

describe('verifierEnv et le stockage', () => {
  const base = {
    MYSQL_URL: 'x', SHOPIFY_STORE_URL: 'x', SHOPIFY_ACCESS_TOKEN: 'x', SHOPIFY_WEBHOOK_SECRET: 'x',
    CLOUDINARY_CLOUD_NAME: 'x', CLOUDINARY_API_KEY: 'x', CLOUDINARY_API_SECRET: 'x',
  };
  it('ovh sans ses variables : critique', () => {
    const b = verifierEnv({ ...base, STOCKAGE_FOURNISSEUR: 'ovh' });
    expect(b.critiques.join(' ')).toMatch(/OVH_S3_BUCKET/);
  });
  it('ovh complet : rien de critique ; valeur inconnue : critique', () => {
    expect(verifierEnv({ ...base, ...ENV }).critiques).toEqual([]);
    expect(verifierEnv({ ...base, STOCKAGE_FOURNISSEUR: 's3' }).critiques.join(' ')).toMatch(/inconnue/);
  });
});
