import { verifierEnv } from './verifier-env';
import { trierPieces, RETENTION_PIECES_MS } from '../shared/cleanup.service';
import { ressourceDepuisUrl } from '../shared/piece-jointe-cloudinary';

const COMPLET = {
  MYSQL_URL: 'mysql://u:p@db/x',
  SHOPIFY_STORE_URL: 'x.myshopify.com',
  SHOPIFY_ACCESS_TOKEN: 'shpat_x',
  SHOPIFY_WEBHOOK_SECRET: 's',
  CLOUDINARY_CLOUD_NAME: 'c',
  CLOUDINARY_API_KEY: 'k',
  CLOUDINARY_API_SECRET: 's',
  FRONTEND_URL: 'https://x',
  ADMIN_SESSION_SECRET: 'a',
  CART_TOKEN_SECRET: 'b',
};

describe('verifierEnv', () => {
  it('ne signale rien sur une configuration complète', () => {
    expect(verifierEnv(COMPLET)).toEqual({ critiques: [], avertissements: [] });
  });

  it('accepte client_id + client_secret à la place du jeton fixe', () => {
    const { SHOPIFY_ACCESS_TOKEN: _, ...sansJeton } = COMPLET;
    expect(
      verifierEnv({ ...sansJeton, SHOPIFY_CLIENT_ID: 'i', SHOPIFY_CLIENT_SECRET: 's' }).critiques,
    ).toEqual([]);
    expect(verifierEnv(sansJeton).critiques).toHaveLength(1);
  });

  it('signale le secret de webhook et Cloudinary manquants', () => {
    const r = verifierEnv({ ...COMPLET, SHOPIFY_WEBHOOK_SECRET: '', CLOUDINARY_API_KEY: ' ' });
    expect(r.critiques.join('\n')).toMatch(/SHOPIFY_WEBHOOK_SECRET/);
    expect(r.critiques.join('\n')).toMatch(/CLOUDINARY_API_KEY/);
  });

  it('avertit sur DB_SYNCHRONIZE=true', () => {
    expect(verifierEnv({ ...COMPLET, DB_SYNCHRONIZE: 'true' }).avertissements).toHaveLength(1);
  });
});

describe('nettoyage des pièces jointes', () => {
  const maintenant = Date.parse('2026-09-30T00:00:00Z');
  const p = (jours: number | null) => ({
    name: 'f.pdf',
    url: 'https://res.cloudinary.com/c/raw/upload/f.pdf',
    type: 'application/pdf',
    uploadedAt: jours === null ? '' : new Date(maintenant - jours * 86_400_000).toISOString(),
  });

  it('garde les pièces récentes (liens des relances), expire les anciennes', () => {
    const { expirees, gardees } = trierPieces([p(3), p(59), p(61), p(null)], maintenant);
    expect(gardees).toHaveLength(2);
    expect(expirees).toHaveLength(2);
    expect(RETENTION_PIECES_MS).toBe(60 * 86_400_000);
  });

  it('ne supprime que les fichiers de NOTRE compte Cloudinary', () => {
    expect(ressourceDepuisUrl('https://res.cloudinary.com/c/raw/upload/v1/customizer/temp-attachments/f.pdf', 'c')).toEqual({
      publicId: 'customizer/temp-attachments/f.pdf',
      resourceType: 'raw',
    });
    expect(ressourceDepuisUrl('https://res.cloudinary.com/autre/raw/upload/f.pdf', 'c')).toBeNull();
    expect(ressourceDepuisUrl('https://evil.com/c/raw/upload/f.pdf', 'c')).toBeNull();
  });
});
