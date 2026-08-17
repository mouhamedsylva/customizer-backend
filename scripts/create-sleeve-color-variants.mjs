/**
 * Crée les variants du produit « Personnalisation manche » : un par
 * combinaison TEXTILE × COULEUR (3 × 40 = 120), chacun avec l'image de CÔTÉ
 * correspondante — c'est la manche que l'on floque, pas la face.
 *
 * Pourquoi : le supplément part vers Shopify comme ligne de panier distincte
 * (recapitulatif.liquid), avec jusqu'ici un variant UNIQUE. La vignette du
 * checkout montrait donc toujours le même visuel, quelle que soit la couleur
 * commandée — incohérent avec la ligne du textile juste au-dessus.
 *
 * Utilisation (depuis customizer-backend/) :
 *   node scripts/create-sleeve-color-variants.mjs            # aperçu, n'écrit rien
 *   node scripts/create-sleeve-color-variants.mjs --apply    # applique
 *
 * Identifiants : SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET du .env, échangés
 * contre un jeton via OAuth client_credentials — même mécanisme que
 * creer-variants-drapeaux.mjs et assigner-images-produits.mjs. Pas de
 * SHOPIFY_ACCESS_TOKEN à renseigner à la main.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COULEURS, TEXTILES, fichiersImage, verifier } from './couleurs-textiles.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(__dirname, '..', '..');
const ASSETS = path.join(RACINE, 'Configurateur-travail', 'assets');

/* Garde-fou : un module incohérent produirait un catalogue incohérent, et le
   constater après 120 variants créés coûte cher. */
const _err = verifier();
if (_err.length) {
  console.error('❌ couleurs-textiles.mjs incohérent :');
  _err.forEach((e) => console.error('   - ' + e));
  process.exit(1);
}

/* ── Environnement ────────────────────────────────────────────────────────── */
const env = {};
const ENV_PATH = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_PATH)) {
  fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach((l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  });
}
const STORE = env.SHOPIFY_STORE_URL || process.env.SHOPIFY_STORE_URL;
const API_VERSION = env.SHOPIFY_API_VERSION || process.env.SHOPIFY_API_VERSION || '2024-01';
const APPLY = process.argv.includes('--apply');

/* Handle plutôt qu'un ID en dur : un ID codé en dur devient faux dès que la
   boutique est dupliquée ou le produit recréé. */
const HANDLE = 'personnalisation-manche';

if (!STORE) { console.error('❌ SHOPIFY_STORE_URL absent du .env'); process.exit(1); }

/* ── Authentification ─────────────────────────────────────────────────────── */
let jeton = null;
async function getJeton() {
  if (jeton) return jeton;
  const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) {
    console.error('❌ OAuth échoué (HTTP ' + r.status + ') :', JSON.stringify(d).slice(0, 200));
    process.exit(1);
  }
  jeton = d.access_token;
  return jeton;
}

async function api(chemin, options = {}) {
  const t = await getJeton();
  const r = await fetch(`https://${STORE}/admin/api/${API_VERSION}${chemin}`, {
    ...options,
    headers: {
      'X-Shopify-Access-Token': t,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch (e) { /* réponse non JSON */ }
  return { ok: r.ok, status: r.status, json, txt };
}

/* Shopify limite à 2 req/s en REST : sans pause, les dernières créations
   repartent en 429 et le catalogue reste à moitié construit. */
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Plan de création ─────────────────────────────────────────────────────── */
/* Ordre TEXTILE puis COULEUR : les variants apparaissent groupés par produit
   dans l'admin, ce qui rend la liste de 120 lisible. */
const plan = [];
for (const [cle, t] of Object.entries(TEXTILES)) {
  for (const c of COULEURS) {
    /* fichiersImage() renvoie les noms à essayer, slug anglais d'abord : dès
       que les visuels définitifs arrivent sous ce nom, ils sont pris sans
       toucher à ce script. */
    const candidats = fichiersImage(t.prefix, c, 'cote');
    const trouve = candidats.find((n) => fs.existsSync(path.join(ASSETS, n)));
    plan.push({
      textile: cle,
      titre: t.titre,
      couleur: c.nom,
      option1: t.titre,        // « Textile - Sweatshirt »
      option2: c.nom,          // « Apricot »
      image: trouve || null,
      candidats
    });
  }
}

const sansImage = plan.filter((p) => !p.image);

console.log('');
console.log('  Produit  : ' + HANDLE);
console.log('  Variants : ' + plan.length + ' (' + Object.keys(TEXTILES).length +
            ' textiles × ' + COULEURS.length + ' couleurs)');
console.log('  Images   : ' + (plan.length - sansImage.length) + '/' + plan.length + ' trouvées (vue de CÔTÉ)');
if (sansImage.length) {
  console.log('  ⚠ sans image : ' + sansImage.slice(0, 8)
    .map((p) => p.textile + '/' + p.couleur).join(', ') + (sansImage.length > 8 ? '…' : ''));
}
console.log('');

if (!APPLY) {
  console.log('  Aperçu — aucune écriture. Extrait du plan :');
  plan.slice(0, 5).forEach((p) => {
    console.log('    ' + p.option1.padEnd(26) + ' / ' + p.option2.padEnd(20) + ' → ' + (p.image || '(aucune image)'));
  });
  console.log('    …');
  console.log('');
  console.log('  Relancer avec --apply pour créer réellement.');
  process.exit(0);
}

/* ── Application ──────────────────────────────────────────────────────────── */
const found = await api(`/products.json?handle=${HANDLE}&limit=1`);
const produit = found.json && found.json.products && found.json.products[0];
if (!produit) { console.error('❌ Produit « ' + HANDLE + ' » introuvable'); process.exit(1); }

console.log('  Produit trouvé : ' + produit.title + ' (id ' + produit.id + ')');
console.log('  Variants actuels : ' + produit.variants.length);
console.log('');

/* Les options sont posées AVANT les variants : un variant à deux options sur
   un produit qui n'en déclare qu'une est rejeté par l'API. On écrase donc la
   structure d'options en une passe, puis on ajoute les variants un à un. */
const prix = produit.variants[0] ? produit.variants[0].price : '4.00';

const maj = await api(`/products/${produit.id}.json`, {
  method: 'PUT',
  body: JSON.stringify({
    product: {
      id: produit.id,
      options: [{ name: 'Textile' }, { name: 'Couleur' }],
      variants: plan.map((p) => ({
        option1: p.option1,
        option2: p.option2,
        price: prix,
        /* Le supplément n'est pas un article stocké : sans cela Shopify le
           refuse dès que l'inventaire tombe à zéro. */
        inventory_management: null,
        requires_shipping: false,
        taxable: true
      }))
    }
  })
});

if (!maj.ok) {
  console.error('❌ Création des variants échouée (HTTP ' + maj.status + ')');
  console.error('   ' + maj.txt.slice(0, 400));
  process.exit(1);
}

const crees = maj.json.product.variants;
console.log('  ✅ ' + crees.length + ' variants créés à ' + prix + ' €');
console.log('');

/* ── Images ───────────────────────────────────────────────────────────────── */
/* Une image par variant, envoyée en base64 : l'API accepte `attachment`, ce qui
   évite d'exposer une URL publique du thème (elle changerait à chaque push). */
let posees = 0, echecs = 0;

for (let i = 0; i < plan.length; i++) {
  const p = plan[i];
  if (!p.image) continue;

  const variant = crees.find((v) => v.option1 === p.option1 && v.option2 === p.option2);
  if (!variant) { echecs++; continue; }

  const b64 = fs.readFileSync(path.join(ASSETS, p.image)).toString('base64');
  const img = await api(`/products/${produit.id}/images.json`, {
    method: 'POST',
    body: JSON.stringify({
      image: {
        attachment: b64,
        filename: p.image,
        alt: p.titre + ' — ' + p.couleur + ' (manche)',
        variant_ids: [variant.id]
      }
    })
  });

  if (img.ok) {
    posees++;
    if (posees % 10 === 0) console.log('    ' + posees + '/' + plan.length + ' images…');
  } else {
    echecs++;
    console.warn('    ⚠ ' + p.image + ' : HTTP ' + img.status);
  }
  await pause(600);
}

console.log('');
console.log('  ✅ ' + posees + ' images associées' + (echecs ? ', ' + echecs + ' échecs' : ''));
console.log('');
console.log('  ÉTAPE SUIVANTE — le thème envoie encore un ID unique');
console.log('  (window.CONF_SLEEVE_VARIANT). Sans table couleur → variant,');
console.log('  toutes les lignes retomberaient sur le même variant.');
console.log('  Lancer : node scripts/exporter-variants.mjs');
