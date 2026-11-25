/**
 * Variables d'environnement vérifiées AU DÉMARRAGE.
 *
 * Aucune n'était contrôlée : l'API démarrait « en bonne santé » sans secret de
 * webhook (chaque webhook refusé en 401), sans Cloudinary (chaque upload en
 * 502) ou sans boutique (URLs `https://undefined/…`). La panne n'apparaissait
 * qu'à l'usage, loin de sa cause.
 */

type Env = Record<string, string | undefined>;

export interface BilanEnv {
  /** Manques qui empêchent une fonction essentielle (commandes, devis, uploads). */
  critiques: string[];
  /** Manques tolérables, mais à connaître. */
  avertissements: string[];
}

const present = (env: Env, k: string) => !!(env[k] && String(env[k]).trim());

export function verifierEnv(env: Env): BilanEnv {
  const critiques: string[] = [];
  const avertissements: string[] = [];

  if (!present(env, 'MYSQL_URL') && !present(env, 'DATABASE_URL')) {
    critiques.push('MYSQL_URL (ou DATABASE_URL) : aucune base de données');
  }
  if (!present(env, 'SHOPIFY_STORE_URL')) {
    critiques.push('SHOPIFY_STORE_URL : boutique inconnue (devis, factures, synchro)');
  }
  if (
    !present(env, 'SHOPIFY_ACCESS_TOKEN') &&
    !(present(env, 'SHOPIFY_CLIENT_ID') && present(env, 'SHOPIFY_CLIENT_SECRET'))
  ) {
    critiques.push(
      'SHOPIFY_ACCESS_TOKEN, ou SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET : aucun accès Shopify',
    );
  }
  if (!present(env, 'SHOPIFY_WEBHOOK_SECRET')) {
    critiques.push('SHOPIFY_WEBHOOK_SECRET : tous les webhooks seront refusés');
  }
  /* Stockage des fichiers. Cloudinary reste requis même après la bascule vers
     OVH : il sert les fichiers d'avant (liens des commandes) et leur suppression. */
  const fournisseur = String(env.STOCKAGE_FOURNISSEUR || 'cloudinary').trim().toLowerCase();
  for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
    if (!present(env, k)) {
      (fournisseur === 'ovh' ? avertissements : critiques).push(
        fournisseur === 'ovh'
          ? `${k} : anciens fichiers Cloudinary ni supprimables ni retrouvables`
          : `${k} : uploads et aperçus impossibles`,
      );
    }
  }
  if (fournisseur !== 'cloudinary' && fournisseur !== 'ovh') {
    critiques.push(`STOCKAGE_FOURNISSEUR=${env.STOCKAGE_FOURNISSEUR} : valeur inconnue (cloudinary ou ovh)`);
  }
  if (fournisseur === 'ovh') {
    for (const k of ['OVH_S3_ENDPOINT', 'OVH_S3_BUCKET', 'OVH_S3_ACCESS_KEY', 'OVH_S3_SECRET_KEY', 'OVH_S3_URL_PUBLIQUE']) {
      if (!present(env, k)) critiques.push(`${k} : uploads impossibles (STOCKAGE_FOURNISSEUR=ovh)`);
    }
    if (present(env, 'OVH_S3_URL_PUBLIQUE') && !/^https:\/\/[^/\s]+\/?$/.test(String(env.OVH_S3_URL_PUBLIQUE).trim())) {
      critiques.push('OVH_S3_URL_PUBLIQUE : https://<bucket>.s3.<région>.io.cloud.ovh.net attendu');
    }
  }

  if (!present(env, 'FRONTEND_URL')) {
    avertissements.push('FRONTEND_URL : seules les origines codées en dur sont autorisées (CORS)');
  }
  if (!present(env, 'ADMIN_SESSION_SECRET')) {
    avertissements.push('ADMIN_SESSION_SECRET : secret généré et gardé en base');
  }
  if (!present(env, 'CART_TOKEN_SECRET')) {
    avertissements.push('CART_TOKEN_SECRET : secret du panier généré');
  }
  if (env.DB_SYNCHRONIZE === 'true') {
    avertissements.push(
      'DB_SYNCHRONIZE=true : TypeORM modifie le schéma au démarrage — à réserver à une base VIDE',
    );
  }
  return { critiques, avertissements };
}
