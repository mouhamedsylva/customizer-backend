/**
 * Rend les PRODUITS du configurateur invisibles sur la boutique, sans les
 * rendre invendables, et ferme leur page produit.
 *
 * Pourquoi
 * --------
 * Ces produits restent vendables : le récapitulatif les ajoute au panier
 * (/cart/add.js) et lit leurs paliers (/products/<handle>.js). Mais leur page
 * était trouvable et achetable directement — des commandes arrivaient SANS
 * AUCUN DESIGN (ex. #21695).
 *
 * Pour chaque produit :
 *   1. statut « Non répertorié » (UNLISTED) : absent de la recherche, des
 *      collections, des recommandations et du sitemap, mais toujours vendable.
 *      Si la boutique ou l'API refuse ce statut : repli sur le métachamp
 *      `seo.hidden = 1` (recherche du site + sitemap) — retirer alors les
 *      produits des collections à la main ;
 *   2. modèle de page `configurateur` (templates/product.configurateur.json) :
 *      la page ne vend rien et renvoie vers le configurateur.
 *
 * Usage (depuis customizer-backend/, CLI Shopify connecté à la boutique)
 * -----
 *   node scripts/masquer-produits-conf.mjs            # marche à blanc
 *   node scripts/masquer-produits-conf.mjs --ecrire   # applique
 *   node scripts/masquer-produits-conf.mjs --annuler --ecrire   # ACTIVE + modèle par défaut
 */
import { execute, boutique } from './pont-cli.mjs';

const ECRIRE = process.argv.includes('--ecrire');
const ANNULER = process.argv.includes('--annuler');
const SUFFIXE = 'configurateur';

/* Mêmes IDs que CONFIGURATOR_PRODUCT_IDS (src/admin/pricing.service.ts), plus
   le supplément manche polyester. */
const PRODUITS = [
  '15982847033678', // textile-sweatshirt
  '15982848246094', // textile-t-shirt-coton
  '15982849130830', // textile-t-shirt-polyester
  '15982850572622', // drapeau-personnalise
  '15982850801998', // patch-personnalise
  '15982850998606', // coin-metal-personnalise
  '15982845854030', // personnalisation-manche
  '15996670869838', // personnalisation-manche-polyester
];

const MAJ = `mutation($input: ProductInput!) {
  productUpdate(input: $input) {
    product { handle status templateSuffix }
    userErrors { field message }
  }
}`;

async function maj(input) {
  const r = await execute(MAJ, { mutation: true, variables: { input } });
  return r?.productUpdate || {};
}

async function principal() {
  console.log(`Boutique : ${boutique()}`);
  if (!ECRIRE) console.log('MARCHE À BLANC — ajouter --ecrire pour appliquer\n');
  let erreurs = 0;

  for (const id of PRODUITS) {
    const gid = `gid://shopify/Product/${id}`;
    const r = await execute(
      `query($id: ID!) { product(id: $id) { handle status templateSuffix } }`,
      { variables: { id: gid } },
    );
    const p = r?.product;
    if (!p) { console.log(`  ✘ ${id} introuvable`); erreurs++; continue; }

    const statutVoulu = ANNULER ? 'ACTIVE' : 'UNLISTED';
    const modeleVoulu = ANNULER ? null : SUFFIXE;
    const avant = `${p.status} / modèle ${p.templateSuffix || '(défaut)'}`;
    const apres = `${statutVoulu} / modèle ${modeleVoulu || '(défaut)'}`;
    if (p.status === statutVoulu && (p.templateSuffix || null) === modeleVoulu) {
      console.log(`  = ${p.handle.padEnd(36)} déjà ${avant}`);
      continue;
    }
    if (!ECRIRE) { console.log(`  → ${p.handle.padEnd(36)} ${avant}  ⇒  ${apres}`); continue; }

    let res = await maj({ id: gid, status: statutVoulu, templateSuffix: modeleVoulu });
    let errs = res.userErrors || [];

    /* Statut UNLISTED refusé (boutique ou version d'API) : modèle seul, puis
       repli SEO. Le produit reste vendable dans tous les cas. */
    if (errs.length && !ANNULER) {
      console.log(`  ! ${p.handle} : statut « Non répertorié » refusé (${errs.map((e) => e.message).join(' | ')})`);
      res = await maj({
        id: gid,
        templateSuffix: modeleVoulu,
        metafields: [{ namespace: 'seo', key: 'hidden', type: 'number_integer', value: '1' }],
      });
      errs = res.userErrors || [];
      if (!errs.length) console.log(`    ↳ repli appliqué : masqué de la recherche et du sitemap (seo.hidden) — retirer des collections à la main`);
    }

    if (errs.length) {
      erreurs++;
      console.log(`  ✘ ${p.handle} : ${errs.map((e) => e.message).join(' | ')}`);
    } else {
      const q = res.product || {};
      console.log(`  ✔ ${String(q.handle || p.handle).padEnd(36)} ${q.status} / modèle ${q.templateSuffix || '(défaut)'}`);
    }
  }
  if (erreurs) process.exit(1);
}

principal().catch((e) => {
  console.error('Erreur :', e.message);
  process.exit(1);
});
