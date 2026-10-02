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

/* ═══ PALETTES PAR PRODUIT — la nouvelle source de vérité ═════════════════

   `COULEURS` ci-dessus est une liste UNIQUE, partagée par les trois textiles.
   Cette hypothèse ne tient plus : depuis les nuanciers fournisseur, chaque
   produit a sa propre palette — 30 pour le sweatshirt, 32 pour le t-shirt
   coton, 17 pour le polyester, avec des teintes différentes pour un même nom
   (« Noir » n'est pas le même noir d'un tissu à l'autre).

   Miroir exact de `Configurateur-travail/assets/conf-palettes.js`, qui pilote
   les pastilles du configurateur. Les deux doivent rester alignés : un nom qui
   diverge ici crée un variant qu'aucune commande ne demandera.

   `COULEURS` est CONSERVÉE : neuf scripts la lisent encore, et les anciens
   variants restent nécessaires aux commandes déjà passées.

   `image` dit si `{prefix}-{slug}-face.png` existe réellement dans le thème.
   Une couleur sans image retombe sur le visuel générique du produit — pas
   d'erreur, mais une vignette de checkout sans la bonne teinte. */
export const PALETTES = {
  sweatshirt: [
    { nom: 'Blanc / Transparent', slug: 'blanc-transparent', hex: '#f0ecec', numero: '01', image: true },
    { nom: 'Blanc rosé', slug: 'blanc-rose', hex: '#f0e6e5', numero: '132', image: true },
    { nom: 'Blanc cassé', slug: 'blanc-casse', hex: '#ededed', numero: '177', image: true },
    { nom: 'Camel', slug: 'camel', hex: '#c09f80', numero: '07', image: true },
    { nom: 'Taupe', slug: 'taupe', hex: '#b7a298', numero: '08', image: true },
    { nom: 'Taupe rosé', slug: 'taupe-rose', hex: '#e0cbc0', numero: '229', image: true },
    { nom: 'Jaune vif', slug: 'jaune-vif', hex: '#fee400', numero: '03', image: true },
    { nom: 'Caramel', slug: 'caramel', hex: '#bc7a2c', numero: '172', image: true },
    { nom: 'Orange vif', slug: 'orange-vif', hex: '#f08927', numero: '31', image: true },
    { nom: 'Rouge cerise', slug: 'rouge-cerise', hex: '#d3315c', numero: '60', image: true },
    { nom: 'Corail', slug: 'corail', hex: '#fb8b89', numero: '120', image: true },
    { nom: 'Mauve foncé', slug: 'mauve-fonce', hex: '#a4767e', numero: '168', image: true },
    { nom: 'Prune', slug: 'prune', hex: '#875560', numero: '169', image: true },
    { nom: 'Bordeaux', slug: 'bordeaux', hex: '#8d1713', numero: '57', image: true },
    { nom: 'Rose fuchsia', slug: 'rose-fuchsia', hex: '#d93280', numero: '78', image: true },
    { nom: 'Rose pâle', slug: 'rose-pale', hex: '#f7d7db', numero: '48', image: true },
    { nom: 'Bleu ciel', slug: 'bleu-ciel', hex: '#4987bc', numero: '05', image: true },
    { nom: 'Bleu azur', slug: 'bleu-azur', hex: '#50b0d9', numero: '12', image: true },
    { nom: 'Bleu marine', slug: 'bleu-marine', hex: '#3f516c', numero: '55', image: true },
    { nom: 'Bleu gris', slug: 'bleu-gris', hex: '#a0a9bd', numero: '263', image: true },
    { nom: 'Gris ardoise', slug: 'gris-ardoise', hex: '#587283', numero: '170', image: true },
    { nom: 'Gris bleuté', slug: 'gris-bleute', hex: '#6d7880', numero: '430', image: true },
    { nom: 'Gris clair', slug: 'gris-clair', hex: '#cececd', numero: '58', image: true },
    { nom: 'Gris perle', slug: 'gris-perle', hex: '#b4afab', numero: '108', image: true },
    { nom: 'Gris anthracite', slug: 'gris-anthracite', hex: '#5e5c68', numero: '231', image: true },
    { nom: 'Vert amande', slug: 'vert-amande', hex: '#d4dcc4', numero: '264', image: true },
    { nom: 'Vert sapin', slug: 'vert-sapin', hex: '#004238', numero: '56', image: true },
    { nom: 'Vert kaki', slug: 'vert-kaki', hex: '#7f8783', numero: '275', image: true },
    { nom: 'Kaki foncé', slug: 'kaki-fonce', hex: '#535f49', numero: '152', image: true },
    { nom: 'Noir', slug: 'noir', hex: '#020204', numero: '02', image: true },
  ],
  tshirt: [
    { nom: 'Blanc', slug: 'blanc', hex: '#fefefd', numero: '01', image: true },
    { nom: 'Camel', slug: 'camel', hex: '#bf9f7f', numero: '07', image: true },
    { nom: 'Rose taupe', slug: 'rose-taupe', hex: '#d9b8a7', numero: '229', image: true },
    // Ex-« Vert olive » : le slug reste celui des fichiers d'images.
    { nom: 'Noyer', slug: 'vert-olive', hex: '#6c614d', numero: '67', image: true },
    { nom: 'Marron chocolat', slug: 'marron-chocolat', hex: '#683d2f', numero: '87', image: true },
    { nom: 'Jaune vif', slug: 'jaune-vif', hex: '#fee403', numero: '03', image: true },
    { nom: 'Orange vif', slug: 'orange-vif', hex: '#f08b2c', numero: '31', image: true },
    { nom: 'Rouge écarlate', slug: 'rouge-ecarlate', hex: '#dc0431', numero: '60', image: true },
    { nom: 'Bordeaux', slug: 'bordeaux', hex: '#8d1713', numero: '57', image: true },
    { nom: 'Rose fuchsia', slug: 'rose-fuchsia', hex: '#db036b', numero: '78', image: true },
    { nom: 'Rose pâle', slug: 'rose-pale', hex: '#f9cdd5', numero: '48', image: true },
    { nom: 'Violet aubergine', slug: 'violet-aubergine', hex: '#760e67', numero: '71', image: true },
    { nom: 'Mauve orchidée', slug: 'mauve-orchidee', hex: '#c57bb0', numero: '230', image: true },
    { nom: 'Bleu roi', slug: 'bleu-roi', hex: '#0461ab', numero: '05', image: true },
    { nom: 'Bleu ciel pâle', slug: 'bleu-ciel-pale', hex: '#c6def1', numero: '10', image: true },
    { nom: 'Bleu turquoise', slug: 'bleu-turquoise', hex: '#04a1d2', numero: '12', image: true },
    { nom: 'Bleu cyan', slug: 'bleu-cyan', hex: '#0291c1', numero: '100', image: true },
    { nom: 'Bleu ardoise', slug: 'bleu-ardoise', hex: '#4d6884', numero: '86', image: true },
    { nom: 'Bleu marine foncé', slug: 'bleu-marine-fonce', hex: '#021f44', numero: '55', image: true },
    { nom: 'Jaune citron', slug: 'jaune-citron', hex: '#ebe567', numero: '118', image: true },
    { nom: 'Vert anis clair', slug: 'vert-anis-clair', hex: '#c2d786', numero: '114', image: true },
    { nom: 'Vert pomme', slug: 'vert-pomme', hex: '#80b95b', numero: '24', image: true },
    { nom: 'Vert prairie', slug: 'vert-prairie', hex: '#559f2a', numero: '83', image: true },
    { nom: 'Vert émeraude', slug: 'vert-emeraude', hex: '#078d19', numero: '216', image: true },
    { nom: 'Vert sapin', slug: 'vert-sapin', hex: '#014138', numero: '56', image: true },
    { nom: 'Kaki doré', slug: 'kaki-dore', hex: '#938e50', numero: '15', image: true },
    { nom: 'Kaki foncé', slug: 'kaki-fonce', hex: '#535f49', numero: '152', image: true },
    { nom: 'Gris clair', slug: 'gris-clair', hex: '#c4c4c4', numero: '58', image: true },
    { nom: 'Gris perle', slug: 'gris-perle', hex: '#b4afab', numero: '108', image: true },
    { nom: 'Gris ardoise foncé', slug: 'gris-ardoise-fonce', hex: '#374047', numero: '231', image: true },
    { nom: 'Vert militaire', slug: 'vert-militaire', hex: '#484e42', numero: '46', image: true },
    { nom: 'Noir', slug: 'noir', hex: '#020204', numero: '02', image: true },
  ],
  tshirt_polyester: [
    { nom: 'Blanc', slug: 'blanc', hex: '#fdfcfa', numero: '01', image: true },
    { nom: 'Beige taupe', slug: 'beige-taupe', hex: '#9a8a70', numero: '219', image: true },
    { nom: 'Jaune vif', slug: 'jaune-vif', hex: '#fce614', numero: '03', image: true },
    { nom: 'Jaune citron', slug: 'jaune-citron', hex: '#e9e66b', numero: '221', image: true },
    { nom: 'Orange vif', slug: 'orange-vif', hex: '#ee8237', numero: '223', image: true },
    { nom: 'Corail', slug: 'corail', hex: '#fb7272', numero: '234', image: true },
    { nom: 'Rouge écarlate', slug: 'rouge-ecarlate', hex: '#dd0636', numero: '60', image: true },
    { nom: 'Rose fuchsia', slug: 'rose-fuchsia', hex: '#d90b6c', numero: '78', image: true },
    { nom: 'Violet indigo', slug: 'violet-indigo', hex: '#49378a', numero: '63', image: true },
    { nom: 'Bleu roi', slug: 'bleu-roi', hex: '#0862a9', numero: '05', image: true },
    { nom: 'Bleu turquoise', slug: 'bleu-turquoise', hex: '#10a2ce', numero: '12', image: true },
    { nom: 'Bleu marine foncé', slug: 'bleu-marine-fonce', hex: '#091f46', numero: '55', image: true },
    { nom: 'Vert émeraude', slug: 'vert-emeraude', hex: '#079a45', numero: '226', image: true },
    { nom: 'Vert anis', slug: 'vert-anis', hex: '#9abf11', numero: '225', image: true },
    { nom: 'Kaki doré', slug: 'kaki-dore', hex: '#948d50', numero: '15', image: true },
    { nom: 'Vert militaire', slug: 'vert-militaire', hex: '#4a4f44', numero: '46', image: true },
    { nom: 'Noir', slug: 'noir', hex: '#020204', numero: '02', image: true },
  ],
};

/** @returns {Array} la palette d'un produit textile. */
export function palette(produit) {
  return PALETTES[produit] || [];
}
