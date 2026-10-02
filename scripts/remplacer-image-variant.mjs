/**
 * Remplace l'IMAGE d'un ou plusieurs variants précis, sans toucher au reste.
 *
 * Cas d'usage : un visuel a été refait sous le MÊME nom de fichier (ex.
 * `tshirt-vert-olive-face.png`, teinte renommée « Noyer » le 02/10/2026). Les
 * autres scripts sautent un variant dont l'image porte déjà ce nom, ou refont
 * tout le produit (`assigner-images-produits.mjs --remplacer`). Celui-ci ne
 * vise que les variants indiqués.
 *
 * Pour chaque variant : l'image est recréée depuis le CDN du thème (Shopify la
 * télécharge à nouveau, donc prend le NOUVEAU fichier), liée au variant, puis
 * l'ancienne image est supprimée si plus aucun variant ne l'utilise.
 * Les identifiants de variants ne changent pas.
 *
 * Usage (depuis customizer-backend/) :
 *   node --env-file=.env scripts/remplacer-image-variant.mjs                  # à blanc, cibles par défaut
 *   node --env-file=.env scripts/remplacer-image-variant.mjs --ecrire
 *   node --env-file=.env scripts/remplacer-image-variant.mjs --cible=<variantId>:<fichier.png> [--cible=…] --ecrire
 *   option --theme=18 : numéro du thème dont le CDN porte les images (défaut 18).
 */

const ECRIRE = process.argv.includes('--ecrire');
const THEME = (process.argv.find((a) => a.startsWith('--theme=')) || '').slice(8) || '18';
const STORE = process.env.SHOPIFY_STORE_URL;
const V = process.env.SHOPIFY_API_VERSION || '2026-07';
const CDN = `https://massacre-officiel.com/cdn/shop/t/${THEME}/assets`;

/* Cibles par défaut : la teinte « Noyer » (ex-Vert olive) du t-shirt coton.
   IDs repris de sections/recapitulatif.liquid. */
const PAR_DEFAUT = [
  { variant: '60636258664782', fichier: 'tshirt-vert-olive-face.png', note: 'T-shirt coton — Noyer' },
  { variant: '60636388557134', fichier: 'tshirt-vert-olive-cote.png', note: 'Personnalisation manche — Noyer' },
];

const cibles = process.argv
  .filter((a) => a.startsWith('--cible='))
  .map((a) => {
    const [variant, fichier] = a.slice(8).split(':');
    if (!/^\d+$/.test(variant || '') || !/^[\w.-]+\.(png|jpe?g|webp)$/i.test(fichier || '')) {
      console.error(`❌ --cible invalide : « ${a} » (attendu --cible=<id>:<fichier.png>)`);
      process.exit(1);
    }
    return { variant, fichier, note: '' };
  });
const CIBLES = cibles.length ? cibles : PAR_DEFAUT;

if (!STORE) {
  console.error('❌ SHOPIFY_STORE_URL requis (lancez avec --env-file=.env).');
  process.exit(1);
}

/* Même échange que le backend (client_credentials) ; jeton fixe en repli. */
let jeton = null;
async function token() {
  if (jeton) return jeton;
  if (!(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET) && process.env.SHOPIFY_ACCESS_TOKEN) {
    return (jeton = process.env.SHOPIFY_ACCESS_TOKEN);
  }
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
  return (jeton = d.access_token);
}

async function api(chemin, opts = {}) {
  const r = await fetch(`https://${STORE}/admin/api/${V}${chemin}`, {
    ...opts,
    headers: { 'X-Shopify-Access-Token': await token(), 'Content-Type': 'application/json' },
  });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* corps non JSON */ }
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${chemin} → ${r.status} ${txt.slice(0, 200)}`);
  return json;
}

async function traiter({ variant, fichier, note }) {
  console.log(`\n• Variant ${variant}${note ? ` (${note})` : ''} → ${fichier}`);

  const url = `${CDN}/${fichier}`;
  const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
  if (!head || !head.ok) {
    console.log(`  ❌ image absente du CDN (${head ? head.status : 'réseau'}) : ${url}`);
    console.log('     Vérifiez qu\'elle est publiée dans le thème, ou passez --theme=<n°>.');
    return;
  }

  const { variant: v } = await api(`/variants/${variant}.json`);
  const { product: p } = await api(`/products/${v.product_id}.json?fields=id,title,images,variants`);
  const ancienne = (p.images || []).find((im) => im.id === v.image_id);
  console.log(`  produit : ${p.title} (${p.id}) — option : ${v.title}`);
  console.log(`  image actuelle : ${ancienne ? ancienne.src.split('/').pop().split('?')[0] : '(aucune)'}`);

  if (!ECRIRE) {
    console.log('  [à blanc] serait remplacée par la version actuelle du CDN.');
    return;
  }

  const { image } = await api(`/products/${p.id}/images.json`, {
    method: 'POST',
    // `?v=` : contourne un éventuel cache côté Shopify sur la même URL.
    body: JSON.stringify({ image: { src: `${url}?v=${Date.now()}`, filename: fichier, variant_ids: [Number(variant)] } }),
  });
  console.log(`  🖼  nouvelle image ${image.id} liée au variant`);

  /* Ancienne image : supprimée seulement si plus aucun AUTRE variant ne
     l'utilise (une image produit peut servir à plusieurs variants). */
  if (ancienne) {
    const encore = (p.variants || []).some((x) => x.id !== v.id && x.image_id === ancienne.id);
    if (encore) {
      console.log(`  ↪ ancienne image ${ancienne.id} conservée : utilisée par d'autres variants`);
    } else {
      await api(`/products/${p.id}/images/${ancienne.id}.json`, { method: 'DELETE' });
      console.log(`  🗑  ancienne image ${ancienne.id} supprimée`);
    }
  }
}

(async () => {
  console.log(`Boutique : ${STORE} | thème t/${THEME} | mode : ${ECRIRE ? 'ÉCRITURE' : 'À BLANC'}`);
  for (const c of CIBLES) {
    try {
      await traiter(c);
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
    }
  }
  console.log(ECRIRE ? '\nTerminé.' : '\nÀ BLANC : rien n\'a été modifié. Relancez avec --ecrire.');
})().catch((e) => { console.error('\n💥', e.message); process.exit(1); });
