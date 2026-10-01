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
  for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
    if (!present(env, k)) critiques.push(`${k} : uploads et aperçus impossibles`);
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
