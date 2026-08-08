/**
 * Palette couleurs textiles — SOURCE UNIQUE pour les scripts Shopify.
 *
 * Miroir de `customizer_frontend/COULEURS-TEXTILES.md` et des 40 pastilles
 * `selColor(this, '<hex>', '<Nom>')` de `sections/configurateur.liquid`.
 * Vérifié le 2026-08-07 : 40 pastilles, 40 entrées au document, 0 hex divergent.
 *
 * Pourquoi ce module existe
 * -------------------------
 * `create-color-variants.mjs` portait sa propre constante `COLORS` avec les
 * **15 anciennes couleurs françaises** (`noir`, `bleu-marine`…), alors que le
 * thème était déjà passé aux **40 couleurs anglaises**. Les deux listes avaient
 * divergé sans que rien ne le signale : le script aurait créé 15 variants dont
 * les libellés ne correspondaient à aucune pastille du configurateur.
 *
 * Le piège des slugs d'images
 * ---------------------------
 * Les images produit livrées portent les **anciens slugs français** :
 * `sweatshirt-noir-face.png`, pas `sweatshirt-black-face.png`. Mesuré : 45
 * fichiers en français, et une seule correspondance directe (`orange`, commun
 * aux deux langues) — donc 39 couleurs sur 40 retombaient sur l'image générique.
 *
 * D'où `slugImage` : la correspondance a été établie par **proximité RGB**, pas
 * en devinant d'après les noms, et les 15 associations sont **EXACTES** (hex
 * identiques au bit près). La nouvelle palette est un renommage anglais de
 * l'ancienne, plus 25 couleurs ajoutées — ce n'est donc pas une approximation.
 *
 * Les 25 couleurs sans image (`slugImage: null`) retombent volontairement sur
 * l'image générique du produit (`{produit}-face.png`), qui existe pour les trois
 * textiles. Fournir `{produit}-{slug}-face.png` avec le slug ANGLAIS suffira à
 * les activer, sans toucher à ce fichier : `slugFichier()` préfère toujours le
 * nom anglais s'il existe.
 */

/**
 * Les 40 couleurs, dans l'ordre du document.
 *
 * - `nom`       : libellé affiché — DOIT être identique au 3ᵉ argument de
 *                 `selColor()` dans le thème, sinon la couleur choisie ne
 *                 retrouve pas son variant Shopify.
 * - `slug`      : slug canonique (anglais), celui du document.
 * - `hex`       : couleur de la pastille.
 * - `slugImage` : slug des fichiers image RÉELLEMENT présents (français), ou
 *                 `null` si aucune image n'a encore été fournie.
 */
export const COULEURS = [
  { nom: 'Apricot',          slug: 'apricot',          hex: '#f5a623', slugImage: null },
  { nom: 'Ash',              slug: 'ash',              hex: '#eff1f0', slugImage: 'blanc-casse' },
  { nom: 'Atoll',            slug: 'atoll',            hex: '#3bb9e0', slugImage: null },
  { nom: 'Black',            slug: 'black',            hex: '#0a0a0a', slugImage: 'noir' },
  { nom: 'Bottle Green',     slug: 'bottle-green',     hex: '#143f2e', slugImage: 'vert-fonce' },
  { nom: 'Brown',            slug: 'brown',            hex: '#3a3130', slugImage: 'marron' },
  { nom: 'Burgundy',         slug: 'burgundy',         hex: '#3d1f35', slugImage: null },
  { nom: 'Chocolate',        slug: 'chocolate',        hex: '#4a3830', slugImage: null },
  { nom: 'Cobalt Blue',      slug: 'cobalt-blue',      hex: '#1e32e6', slugImage: null },
  { nom: 'Dark Grey',        slug: 'dark-grey',        hex: '#2e3944', slugImage: 'gris-fonce' },
  { nom: 'Diva Blue',        slug: 'diva-blue',        hex: '#1e6b78', slugImage: null },
  { nom: 'Fire Red',         slug: 'fire-red',         hex: '#e01e1e', slugImage: 'rouge' },
  { nom: 'Gold',             slug: 'gold',             hex: '#f5c518', slugImage: null },
  { nom: 'Kelly Green',      slug: 'kelly-green',      hex: '#2fa84f', slugImage: null },
  { nom: 'Millennial Lilac', slug: 'millennial-lilac', hex: '#6e7bd8', slugImage: null },
  { nom: 'Millennial Mint',  slug: 'millennial-mint',  hex: '#9ee5c4', slugImage: null },
  { nom: 'Natural',          slug: 'natural',          hex: '#e8e2d0', slugImage: null },
  { nom: 'Navy',             slug: 'navy',             hex: '#1a2438', slugImage: 'bleu-marine' },
  { nom: 'Navy Blue',        slug: 'navy-blue',        hex: '#1b2a5b', slugImage: null },
  { nom: 'Orange',           slug: 'orange',           hex: '#f0500a', slugImage: 'orange' },
  { nom: 'Orchid Green',     slug: 'orchid-green',     hex: '#7de01e', slugImage: null },
  { nom: 'Orchid Pink',      slug: 'orchid-pink',      hex: '#f5c8dc', slugImage: 'rose-clair' },
  { nom: 'Pacific Grey',     slug: 'pacific-grey',     hex: '#8a8d91', slugImage: null },
  { nom: 'Pixel Lime',       slug: 'pixel-lime',       hex: '#a8e020', slugImage: null },
  { nom: 'Radiant Purple',   slug: 'radiant-purple',   hex: '#3a1e9e', slugImage: 'violet' },
  { nom: 'Red',              slug: 'red',              hex: '#a81e32', slugImage: null },
  { nom: 'Royal Blue',       slug: 'royal-blue',       hex: '#1e4be0', slugImage: null },
  { nom: 'Sand',             slug: 'sand',             hex: '#c4b49a', slugImage: null },
  { nom: 'Sky',              slug: 'sky',              hex: '#9ed8f0', slugImage: 'bleu-ciel' },
  { nom: 'Solar Yellow',     slug: 'solar-yellow',     hex: '#f5e518', slugImage: 'jaune' },
  { nom: 'Sorbet',           slug: 'sorbet',           hex: '#b01e78', slugImage: 'rose' },
  { nom: 'Sport Grey',       slug: 'sport-grey',       hex: '#8a9499', slugImage: 'gris' },
  { nom: 'Stone Blue',       slug: 'stone-blue',       hex: '#3e6b85', slugImage: 'gris-ardoise' },
  { nom: 'Sunset Orange',    slug: 'sunset-orange',    hex: '#f5455e', slugImage: null },
  { nom: 'Swimming Pool',    slug: 'swimming-pool',    hex: '#5ed0c4', slugImage: null },
  { nom: 'Urban Khaki',      slug: 'urban-khaki',      hex: '#3a4130', slugImage: null },
  { nom: 'Urban Orange',     slug: 'urban-orange',     hex: '#c43418', slugImage: null },
  { nom: 'Urban Purple',     slug: 'urban-purple',     hex: '#1e1e6e', slugImage: null },
  { nom: 'Used Black',       slug: 'used-black',       hex: '#2e3438', slugImage: null },
  { nom: 'White',            slug: 'white',            hex: '#ffffff', slugImage: null },
];

/**
 * Les trois produits textiles : clé interne -> préfixe des fichiers image.
 *
 * `productId` n'est PAS ici, volontairement : ces IDs sont propres à une
 * boutique. Les scripts les découvrent par `handle` (voir `setup-boutique.mjs`),
 * ce qui rend l'outillage réutilisable sur la boutique d'un client.
 */
export const TEXTILES = {
  sweatshirt:       { prefix: 'sweatshirt',       handle: 'textile-sweatshirt',            titre: 'Textile - Sweatshirt',          prix: '60.00' },
  tshirt:           { prefix: 'tshirt',           handle: 'textile-t-shirt-coton',         titre: 'Textile - T-shirt Coton',       prix: '29.50' },
  tshirt_polyester: { prefix: 'tshirt-polyester', handle: 'textile-t-shirt-polyester',     titre: 'Textile - T-shirt Polyester',   prix: '29.50' },
};

/**
 * Les produits NON textiles (un seul variant « Default Title »).
 *
 * `coin-metal-personnalise` est à 0,00 € : c'est VOULU. Les coins se vendent
 * uniquement sur devis (prix variable selon finition, gravure, quantité), et
 * `CONF_VARIANTS` de recapitulatif.liquid omet délibérément la clé `patches`
 * pour que `variantForItem()` renvoie `undefined` et déclenche la bascule devis.
 * Le produit existe quand même : il sert de référence au dashboard admin.
 */
export const SIMPLES = {
  drapeaux: { handle: 'drapeau-personnalise',      titre: 'Drapeau personnalisé',    prix: '19.90' },
  coins:    { handle: 'patch-personnalise',        titre: 'Patch personnalisé',      prix: '20.00' },
  patches:  { handle: 'coin-metal-personnalise',   titre: 'Coin métal personnalisé', prix: '0.00'  },
};

/**
 * Nom du fichier image à chercher pour une couleur et une vue.
 *
 * Préfère TOUJOURS le slug anglais : dès que les visuels définitifs sont livrés
 * sous ce nom, ils sont pris automatiquement, sans modifier ce module. Le slug
 * français n'est qu'un repli pour les 15 couleurs déjà photographiées.
 *
 * @param {string} prefix  préfixe produit ('sweatshirt', 'tshirt', …)
 * @param {object} couleur une entrée de COULEURS
 * @param {string} [vue]   'face' | 'dos' | 'cote'
 * @returns {string[]} noms de fichiers à essayer, dans l'ordre de préférence
 */
export function fichiersImage(prefix, couleur, vue = 'face') {
  const noms = [`${prefix}-${couleur.slug}-${vue}.png`];
  if (couleur.slugImage && couleur.slugImage !== couleur.slug) {
    noms.push(`${prefix}-${couleur.slugImage}-${vue}.png`);
  }
  return noms;
}

/** Garde-fou : le module doit rester cohérent avec le document. */
export function verifier() {
  const erreurs = [];
  if (COULEURS.length !== 40) erreurs.push(`${COULEURS.length} couleurs au lieu de 40`);

  const vus = new Set();
  for (const c of COULEURS) {
    if (vus.has(c.slug)) erreurs.push(`slug en double : ${c.slug}`);
    vus.add(c.slug);
    if (!/^#[0-9a-f]{6}$/i.test(c.hex)) erreurs.push(`hex invalide pour ${c.nom} : ${c.hex}`);
    if (!c.nom || !c.slug) erreurs.push(`entrée incomplète : ${JSON.stringify(c)}`);
  }
  const avecImage = COULEURS.filter((c) => c.slugImage).length;
  if (avecImage !== 15) {
    erreurs.push(`${avecImage} couleurs avec image au lieu de 15 (mesuré sur assets/)`);
  }
  return erreurs;
}
