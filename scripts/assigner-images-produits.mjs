/**
 * Assigne leurs images aux 7 produits du configurateur.
 *
 * Pourquoi ce script existe
 * -------------------------
 * Les produits ont été créés sans média (mesuré : `images = 0` sur les 7, et
 * aucun variant rattaché à une image). Dans l'admin Shopify, la liste des
 * produits affiche donc des vignettes vides, et le panier natif n'a rien à
 * montrer.
 *
 * `scripts/reassign-variant-images.mjs` faisait ce travail en REST avec
 * `SHOPIFY_ACCESS_TOKEN`. Ce jeton appartenait à la boutique de développement et
 * renvoie 401 sur `38cca3` — d'où ce nouveau script, qui passe par le même
 * échange `client_credentials` que le backend.
 *
 * Source des images
 * -----------------
 * Le CDN du thème BROUILLON `t/18`, où les 280 visuels du configurateur sont
 * déjà déployés (vérifié : HTTP 200). Shopify télécharge l'image depuis l'URL
 * fournie, il n'y a donc rien à envoyer depuis le disque.
 *
 * Couverture des couleurs
 * -----------------------
 * Seules 15 des 40 couleurs ont un visuel dédié (`slugImage` renseigné dans
 * couleurs-textiles.mjs). Les 25 autres reçoivent l'image générique du produit :
 * une vignette juste-mais-imprécise vaut mieux qu'une case vide, et le
 * configurateur — lui — affiche le bon rendu quoi qu'il arrive.
 *
 * Usage (depuis customizer-backend/) :
 *   node --env-file=.env scripts/assigner-images-produits.mjs            # à blanc
 *   node --env-file=.env scripts/assigner-images-produits.mjs --ecrire
 *   node --env-file=.env scripts/assigner-images-produits.mjs --ecrire --only=coins
 */
import { COULEURS } from './couleurs-textiles.mjs';

const ECRIRE = process.argv.includes('--ecrire');
/* Refait l'assignation même si les variants ont déjà une image : purge les
   anciennes, repose les bonnes. À utiliser quand les VISUELS ont changé. */
const REMPLACER = process.argv.includes('--remplacer');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);

const STORE = process.env.SHOPIFY_STORE_URL;
const V = process.env.SHOPIFY_API_VERSION || '2026-07';
/* Thème BROUILLON : c'est lui qui porte les assets du configurateur. Le thème
   actif ne les a pas (mesuré : 404 sur t/15). */
const CDN = 'https://massacre-officiel.com/cdn/shop/t/18/assets';

/** Produits à traiter. `image` = visuel générique, servant de repli. */
const PRODUITS = {
  sweatshirt: { handle: 'textile-sweatshirt', prefixe: 'sweatshirt', image: 'sweatshirt-face.png' },
  tshirt: { handle: 'textile-t-shirt-coton', prefixe: 'tshirt', image: 'tshirt-face.png' },
  tshirt_polyester: { handle: 'textile-t-shirt-polyester', prefixe: 'tshirt-polyester', image: 'tshirt-polyester-face.png' },
  /* Drapeaux : 4 variants couleur depuis le 11/08/2026. `couleurs` porte la
     correspondance libellé de variant -> fichier, car les noms diffèrent
     (« Bleu » côté thème, `bleu-marine` côté fichier) et la table
     couleurs-textiles.mjs ne couvre que les textiles. */
  drapeaux: {
    handle: 'drapeau-personnalise',
    image: 'flag-recto.png',
    couleurs: {
      Blanc: 'flag-0an-blanc-recto-paysage.png',
      Noir: 'flag-0an-noir-recto-paysage.png',
      Rouge: 'flag-0an-rouge-recto-paysage.png',
      Bleu: 'flag-0an-bleu-marine-recto-paysage.png',
    },
  },
  coins: { handle: 'patch-personnalise', image: 'patch-recto.png' },
  patches: { handle: 'coin-metal-personnalise', image: 'coin-massacre.png' },
  manche: { handle: 'personnalisation-manche', image: 'sweatshirt-face.png' },
};

let jeton = null;
async function token() {
  if (jeton) return jeton;
  const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  if (!r.ok) throw new Error(`OAuth ${r.status} : ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  if (!d.access_token) throw new Error('Réponse OAuth sans access_token.');
  jeton = d.access_token;
  return jeton;
}

async function api(chemin, opts = {}) {
  const t = await token();
  const r = await fetch(`https://${STORE}/admin/api/${V}${chemin}`, {
    ...opts,
    headers: {
      'X-Shopify-Access-Token': t,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* corps non JSON */ }
  return { ok: r.ok, status: r.status, json, txt };
}

/** L'image existe-t-elle sur le CDN ? Une URL morte ferait échouer la création
 *  côté Shopify avec un message peu clair — on filtre en amont. */
async function imageExiste(fichier) {
  try {
    const r = await fetch(`${CDN}/${fichier}`, { method: 'HEAD' });
    return r.ok;
  } catch { return false; }
}

async function traiter(cle, def) {
  const res = await api(`/products.json?limit=1&handle=${def.handle}&fields=id,handle,images,variants`);
  const p = res.json?.products?.[0];
  if (!p) { console.log(`  ${cle.padEnd(18)} INTROUVABLE (${def.handle})`); return; }

  const variants = p.variants || [];
  console.log(`\n  ${cle} — ${def.handle} (${variants.length} variant${variants.length > 1 ? 's' : ''})`);

  /* 1) Images à créer : le visuel générique, plus un par couleur disponible.
        Créer d'abord évite un aller-retour par variant. */
  const aCreer = new Map();   // fichier -> [ids de variants]
  if (def.couleurs) {
    // Table explicite libellé -> fichier (drapeaux).
    for (const v of variants) {
      const fichier = def.couleurs[v.title] || def.couleurs[v.option1] || def.image;
      if (!aCreer.has(fichier)) aCreer.set(fichier, []);
      aCreer.get(fichier).push(v.id);
    }
  } else if (def.prefixe) {
    /* Textiles : le fichier porte le SLUG ANGLAIS de la couleur.

       C'était `slugImage` — le slug français des 15 visuels livrés à l'origine.
       Les 25 autres couleurs n'en avaient pas et retombaient sur l'image
       générique. Depuis le 12/08/2026 les 360 visuels existent, nommés
       `{prefixe}-{slug}-{vue}.png` (scripts/renommer-images-textiles.mjs) : le
       `slug` suffit, et chaque couleur a son propre visuel.

       `def.image` reste le repli — utile si un fichier manque encore : mieux
       vaut une vignette approximative qu'un variant sans image. */
    for (const v of variants) {
      const couleur = COULEURS.find((c) => c.nom === v.title || c.nom === v.option1);
      const fichier = couleur
        ? `${def.prefixe}-${couleur.slug}-face.png`
        : def.image;
      if (!aCreer.has(fichier)) aCreer.set(fichier, []);
      aCreer.get(fichier).push(v.id);
    }
  } else {
    aCreer.set(def.image, variants.map((v) => v.id));
  }

  /* 2) Filtrer les fichiers absents du CDN. Sans ce contrôle, Shopify accepte la
        requête puis échoue au téléchargement, en laissant un média vide. */
  const valides = new Map();
  for (const [fichier, ids] of aCreer) {
    if (await imageExiste(fichier)) valides.set(fichier, ids);
    else console.log(`    image absente du CDN, ignorée : ${fichier}`);
  }

  const nbCouleurs = [...valides.keys()].filter((f) => f !== def.image).length;
  console.log(`    ${valides.size} image(s) : ${nbCouleurs} par couleur + générique`);

  if (!ECRIRE) {
    console.log('    (marche à blanc — relancer avec --ecrire)');
    return;
  }

  /* Garde d'idempotence : on saute le produit si TOUS ses variants sont déjà
     rattachés à une image. Tester la simple présence d'images ne suffisait pas —
     un produit dont on vient d'ajouter des variants couleur a bien une image,
     mais ces nouveaux variants n'y sont pas rattachés.

     `--remplacer` la contourne : utile quand les visuels ont CHANGÉ sans que le
     rattachement bouge. C'est le cas après l'arrivée des 360 fichiers du
     12/08/2026 — 25 couleurs sur 40 pointaient encore vers l'image générique. */
  const orphelins = variants.filter((v) => !v.image_id);
  if (!orphelins.length && !REMPLACER) {
    console.log(
      `    ${variants.length} variant(s) déjà rattaché(s) — produit ignoré` +
        ' (--remplacer pour refaire)',
    );
    return;
  }
  if ((p.images || []).length) {
    console.log(`    ${p.images.length} image(s) présente(s), ${orphelins.length} variant(s) sans image`);
  }

  /* Purge AVANT de reposer : sans elle, les anciennes images s'ajouteraient aux
     nouvelles (16 + 40 = 56 médias par produit), et l'admin Shopify afficherait
     une galerie encombrée de doublons approximatifs. Supprimer une image détache
     automatiquement ses variants — ils seront rerattachés juste après. */
  if (REMPLACER && (p.images || []).length) {
    for (const im of p.images) {
      const d = await api(`/products/${p.id}/images/${im.id}.json`, { method: 'DELETE' });
      if (!d.ok) console.log(`      purge ECHEC image ${im.id} : ${d.status}`);
    }
    console.log(`    ${p.images.length} ancienne(s) image(s) supprimée(s)`);
  }

  for (const [fichier, ids] of valides) {
    const r = await api(`/products/${p.id}/images.json`, {
      method: 'POST',
      body: JSON.stringify({
        image: {
          src: `${CDN}/${fichier}`,
          /* Rattache les variants dès la création : un second appel par variant
             multiplierait les requêtes et le risque de heurter le quota. */
          variant_ids: ids,
          alt: `${p.handle} — ${fichier.replace(/\.png$/, '')}`,
        },
      }),
    });
    console.log(
      r.ok
        ? `    OK    ${fichier.padEnd(38)} (${ids.length} variant${ids.length > 1 ? 's' : ''})`
        : `    ECHEC ${fichier} : ${r.status} ${(r.txt || '').slice(0, 120)}`,
    );
  }
}

async function principal() {
  if (!STORE || !process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET) {
    console.error('SHOPIFY_STORE_URL, SHOPIFY_CLIENT_ID et SHOPIFY_CLIENT_SECRET requis.');
    process.exit(1);
  }
  console.log(`Boutique : ${STORE}`);
  console.log(`Images   : ${CDN}`);
  console.log(ECRIRE ? '\nMODE ÉCRITURE' : '\nMARCHE À BLANC');

  for (const [cle, def] of Object.entries(PRODUITS)) {
    if (ONLY && ONLY !== cle) continue;
    await traiter(cle, def);
  }
  console.log('');
}

principal().catch((e) => {
  console.error('Erreur :', e.message);
  process.exit(1);
});
