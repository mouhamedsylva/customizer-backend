/**
 * Remplace les variants couleur des trois textiles par leurs NOUVELLES palettes.
 *
 * Pourquoi un script de plus
 * --------------------------
 * `create-color-variants.mjs` crée l'option « Couleur » sur un produit qui n'en
 * a pas, et REFUSE de continuer si elle existe déjà — garde-fou anti-doublon,
 * légitime pour une première mise en place. Ici les trois produits portent déjà
 * 40 variants ; il faut donc les REMPLACER, pas les créer.
 *
 * Ce que fait ce script
 * ---------------------
 *   1. lit la palette du produit dans `couleurs-textiles.mjs` (PALETTES) ;
 *   2. remplace la liste des valeurs de l'option « Couleur » ;
 *   3. assigne à chaque variant l'image `{prefix}-{slug}-face.png` du thème ;
 *   4. affiche les anciens variants devenus orphelins.
 *
 * APERÇU PAR DÉFAUT. Rien n'est écrit sans `--apply` : le catalogue d'une
 * boutique en production ne se modifie pas par accident.
 *
 * Utilisation (depuis customizer-backend/) :
 *   node scripts/remplacer-variants-palettes.mjs                    # aperçu
 *   node scripts/remplacer-variants-palettes.mjs --only=sweatshirt  # un produit
 *   node scripts/remplacer-variants-palettes.mjs --apply            # applique
 *
 * Le jeton est obtenu par ÉCHANGE client_id/client_secret (flux
 * `client_credentials`) : les applications personnalisées récentes ne
 * fournissent plus de jeton permanent, et `SHOPIFY_ACCESS_TOKEN` est vide.
 * Le jeton obtenu vit 24 h — largement assez, et rien n'est stocké sur disque.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTES, TEXTILES } from './couleurs-textiles.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..');

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;
const THEME_PATH =
  (process.argv.find((a) => a.startsWith('--theme-path=')) || '').split('=')[1] || null;

/* ── Environnement ──────────────────────────────────────────────────────── */

function lireEnv() {
  const env = {};
  const brut = fs.readFileSync(path.join(RACINE, '.env'), 'utf8');
  for (const ligne of brut.split(/\r?\n/)) {
    if (/^\s*#/.test(ligne)) continue;
    const i = ligne.indexOf('=');
    if (i < 1) continue;
    env[ligne.slice(0, i).trim()] = ligne.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const ENV = lireEnv();
const STORE = ENV.SHOPIFY_STORE_URL;
const API_VERSION = ENV.SHOPIFY_API_VERSION || '2024-01';

if (!STORE) {
  console.error('❌ SHOPIFY_STORE_URL absent de .env');
  process.exit(1);
}

/**
 * Jeton d'accès, par échange des identifiants d'application.
 *
 * `SHOPIFY_ACCESS_TOKEN` est vide : depuis la refonte des applications
 * personnalisées, le jeton se demande à la volée. Il porte les portées
 * accordées à l'app — `write_products` est celle qu'il nous faut.
 */
async function obtenirJeton() {
  const { SHOPIFY_CLIENT_ID: id, SHOPIFY_CLIENT_SECRET: secret } = ENV;
  if (!id || !secret) {
    console.error('❌ SHOPIFY_CLIENT_ID et SHOPIFY_CLIENT_SECRET requis dans .env');
    process.exit(1);
  }
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }),
  });
  if (!res.ok) {
    console.error(`❌ Jeton refusé (HTTP ${res.status}) : ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json();
  if (!String(data.scope || '').includes('write_products')) {
    console.error(`❌ L'application n'a pas la portée write_products (portées : ${data.scope})`);
    process.exit(1);
  }
  return data.access_token;
}

let JETON = null;

async function shopify(chemin, methode = 'GET', corps) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}${chemin}`, {
    method: methode,
    headers: { 'X-Shopify-Access-Token': JETON, 'Content-Type': 'application/json' },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const texte = await res.text();
  if (!res.ok) throw new Error(`Shopify ${methode} ${chemin} -> ${res.status} : ${texte}`);
  return texte ? JSON.parse(texte) : {};
}

/* ── Images du thème ────────────────────────────────────────────────────── */

/* Le chemin du thème (`t/5`) n'est pas devinable de façon fiable : il change
   d'un thème à l'autre. On le découvre en essayant les valeurs plausibles sur
   une image dont on sait qu'elle existe, plutôt que de le coder en dur. */
async function trouverCheminTheme() {
  if (THEME_PATH) return THEME_PATH;
  for (let i = 1; i <= 30; i++) {
    const url = `https://${STORE}/cdn/shop/t/${i}/assets/sweatshirt-noir-face.png`;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return `t/${i}`;
    } catch { /* chemin suivant */ }
  }
  return null;
}

let CHEMIN_THEME = null;
const cacheUrl = new Map();

async function urlAsset(fichier) {
  if (!CHEMIN_THEME) return null;
  if (cacheUrl.has(fichier)) return cacheUrl.get(fichier);
  const url = `https://${STORE}/cdn/shop/${CHEMIN_THEME}/assets/${fichier}`;
  let ok = null;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    ok = res.ok ? url : null;
  } catch { ok = null; }
  cacheUrl.set(fichier, ok);
  return ok;
}

/* ── Traitement d'un produit ────────────────────────────────────────────── */

async function traiter(cle, produitId) {
  const conf = TEXTILES[cle];
  const palette = PALETTES[cle] || [];
  console.log(`\n═══ ${cle} — ${palette.length} couleurs ═══`);

  const { product } = await shopify(`/products/${produitId}.json`);
  const anciens = product.variants.map((v) => v.option1);
  const nouveaux = palette.map((c) => c.nom);

  const orphelins = anciens.filter((a) => !nouveaux.includes(a));
  const ajouts = nouveaux.filter((n) => !anciens.includes(n));
  const gardes = nouveaux.filter((n) => anciens.includes(n));

  console.log(`  variants actuels : ${anciens.length}`);
  console.log(`  conservés        : ${gardes.length}${gardes.length ? ' (' + gardes.join(', ') + ')' : ''}`);
  console.log(`  ajoutés          : ${ajouts.length}`);
  console.log(`  retirés          : ${orphelins.length}`);

  /* Images : une par couleur, la vue de FACE. C'est elle qui s'affiche comme
     vignette de ligne au checkout. */
  const plan = [];
  let avec = 0, sans = 0;
  for (const c of palette) {
    const fichier = `${conf.prefix}-${c.slug}-face.png`;
    const url = await urlAsset(fichier);
    if (url) avec++; else sans++;
    plan.push({ nom: c.nom, fichier, url });
  }
  console.log(`  images trouvées  : ${avec}/${palette.length}${sans ? ` (${sans} sans image)` : ''}`);
  if (sans) {
    console.log('    sans image : ' + plan.filter((p) => !p.url).map((p) => p.nom).join(', '));
  }

  if (!APPLY) {
    console.log('  [aperçu] rien n\'a été modifié — relancer avec --apply');
    return { cle, orphelins, ajouts };
  }

  const prix = product.variants[0]?.price || '29.50';

  /* Un seul PUT porte l'option ET les variants : Shopify rejette une liste de
     valeurs d'option qui ne correspond pas exactement aux variants envoyés. */
  console.log('  → remplacement des variants…');
  await shopify(`/products/${produitId}.json`, 'PUT', {
    product: {
      id: produitId,
      options: [{ name: 'Couleur', values: nouveaux }],
      variants: palette.map((c) => ({
        option1: c.nom,
        price: prix,
        /* Produit personnalisé à la demande : jamais en rupture. */
        inventory_management: null,
        inventory_policy: 'continue',
      })),
    },
  });

  /* Rechargement : les identifiants des variants viennent d'être réattribués. */
  const { product: maj } = await shopify(`/products/${produitId}.json`);
  const parNom = {};
  for (const v of maj.variants) parNom[v.option1] = v.id;

  let posees = 0;
  for (const p of plan) {
    const variantId = parNom[p.nom];
    if (!p.url || !variantId) continue;
    try {
      await shopify(`/products/${produitId}/images.json`, 'POST', {
        image: { src: p.url, filename: p.fichier, variant_ids: [variantId] },
      });
      posees++;
    } catch (e) {
      console.log(`    ⚠ image ${p.nom} : ${e.message.slice(0, 90)}`);
    }
  }
  console.log(`  ✅ ${maj.variants.length} variants, ${posees} images assignées`);
  return { cle, orphelins, ajouts, variants: maj.variants };
}

/* ── Point d'entrée ─────────────────────────────────────────────────────── */

(async function main() {
  JETON = await obtenirJeton();
  CHEMIN_THEME = await trouverCheminTheme();
  console.log(`Boutique : ${STORE} (API ${API_VERSION})`);
  console.log(`Thème    : ${CHEMIN_THEME || '⚠ introuvable — aucune image ne sera assignée'}`);
  console.log(APPLY ? '⚠  MODE APPLICATION — le catalogue va être modifié'
                    : 'Mode APERÇU — aucune modification');

  const handles = {
    sweatshirt: 'textile-sweatshirt',
    tshirt: 'textile-t-shirt-coton',
    tshirt_polyester: 'textile-t-shirt-polyester',
  };

  const resultats = [];
  for (const cle of Object.keys(handles)) {
    if (ONLY && ONLY !== cle) continue;
    const { products } = await shopify(`/products.json?handle=${handles[cle]}`);
    const p = (products || [])[0];
    if (!p) { console.log(`\n⚠ ${cle} : produit « ${handles[cle]} » introuvable`); continue; }
    resultats.push(await traiter(cle, p.id));
  }

  console.log('\n─── Récapitulatif ───');
  for (const r of resultats) {
    console.log(`${r.cle.padEnd(18)} +${r.ajouts.length} / −${r.orphelins.length}`);
  }
  if (!APPLY) console.log('\nRelancer avec --apply pour écrire.');
})().catch((e) => {
  console.error('❌ ' + e.message);
  process.exit(1);
});
