/**
 * COMMANDES MANUELLES — saisies par l'admin pour une commande reçue par e-mail,
 * téléphone ou bon de commande, hors boutique. Elles vivent dans le dashboard
 * SEULEMENT : rien n'est créé sur Shopify (pas d'e-mail au client, pas de stock).
 *
 * Identifiant : un `shopifyOrderId` NÉGATIF (-1, -2…). Shopify n'émet que des
 * identifiants positifs : aucune collision possible avec une vraie commande,
 * que la synchro ou un webhook viendrait sinon écraser. Le signe suffit à les
 * reconnaître partout, sans colonne supplémentaire.
 *
 * Numéro lisible : « M-1001 », « M-1002 »…
 *
 * Les lignes ont la forme de celles de Shopify (`title`, `quantity`,
 * `properties: [{name, value}]`) : carte, fiche de production, filtres par
 * article, export CSV et ZIP les traitent comme les autres.
 */

/** La commande a-t-elle été saisie à la main ? */
export function estCommandeManuelle(id: unknown): boolean {
  return /^-\d+$/.test(String(id ?? ''));
}

/** Numéro lisible d'une commande manuelle, depuis son identifiant (-1 → M-1001). */
export function numeroManuel(id: string): string {
  return `M-${1000 + Math.abs(parseInt(id, 10))}`;
}

export const MAX_LIGNES_MANUELLES = 30;

/**
 * Propriété CACHÉE (le « _ » la masque au client) posée sur chaque ligne du
 * brouillon Shopify : elle porte l'identifiant de la commande manuelle. Quand
 * le client paie, la commande Shopify qui en naît la porte encore — c'est elle
 * qui permet de lui transférer fichiers, note et suivi (webhooks.service.ts).
 */
export const PROPRIETE_COMMANDE_MANUELLE = '_Commande manuelle';
export const RE_PROPRIETE_COMMANDE_MANUELLE = /^_?Commande manuelle$/i;

/**
 * CATALOGUE FERMÉ des articles d'une commande manuelle : l'admin choisit dans
 * la liste, il ne saisit pas. Le titre détermine aussi la famille du filtre
 * « par article » (familles-articles.ts) : un titre libre y tombait dans
 * « Autres ».
 */
export const CATALOGUE_MANUEL: Array<{ famille: string; icone: string; articles: string[] }> = [
  { famille: 'Patchs', icone: '🏷', articles: ['Patch personnalisé (PVC)', 'Patch personnalisé (brodé)', 'Patch personnalisé (tissé)'] },
  { famille: 'Coins', icone: '🪙', articles: ['Coin métal personnalisé'] },
  { famille: 'Drapeaux', icone: '🚩', articles: ['Drapeau personnalisé'] },
  {
    famille: 'Textiles',
    icone: '👕',
    articles: ['T-shirt coton personnalisé', 'T-shirt polyester personnalisé', 'Sweatshirt personnalisé'],
  },
];
export const ARTICLES_MANUELS: string[] = CATALOGUE_MANUEL.flatMap((f) => f.articles);

/** Textiles : les seuls articles qui acceptent une personnalisation de manche. */
export const ARTICLES_TEXTILES: string[] = CATALOGUE_MANUEL.find((f) => f.famille === 'Textiles')?.articles ?? [];

/** Manches cochées d'un article (« droite », « gauche »), seulement pour un textile. */
export function manchesDe(titre: string, brut: unknown): Array<'droite' | 'gauche'> {
  if (!ARTICLES_TEXTILES.includes(titre) || !Array.isArray(brut)) return [];
  return (['droite', 'gauche'] as const).filter((m) => brut.includes(m));
}

/** Designs joints à une même ligne d'article, au plus. */
export const MAX_DESIGNS_PAR_LIGNE = 5;

/**
 * Ajoute le design d'un article : propriété « Design » (puis « Design 2 »…) sur
 * la ligne. Carte, fiche de production et ZIP l'affichent avec l'article, et
 * le brouillon Shopify la reprend.
 */
/** Designs renvoyés par le formulaire de modification : liens Cloudinary seulement. */
export function designsConserves(brut: unknown): string[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .map((u) => String(u ?? '').trim())
    .filter((u) => /^https:\/\/res\.cloudinary\.com\/[^\s"'<>]+$/.test(u))
    .slice(0, MAX_DESIGNS_PAR_LIGNE);
}

/** Propriétés « Design », « Design 2 »… d'une ligne. */
export const RE_DESIGN = /^Design( \d+)?$/;

/** Vues (emplacements) où se marque un texte ou un logo. */
export const VUES_MANUELLES = ['Face', 'Dos', 'Cœur', 'Manche droite', 'Manche gauche'] as const;

/**
 * Polices proposées : EXACTEMENT celles du configurateur, dans le même ordre
 * (Configurateur-travail/assets/conf-text-editor.js, tableau FONTS).
 */
export const POLICES_MANUELLES = [
  'Arial', 'Impact', 'Bebas Neue', 'Oswald', 'Teko', 'Montserrat', 'Poppins', 'Righteous', 'Fredoka',
  'Bangers', 'Luckiest Guy', 'Shrikhand', 'Lobster', 'Pacifico', 'Dancing Script', 'Great Vibes',
  'Sacramento', 'Satisfy', 'Yellowtail', 'Caveat', 'Permanent Marker', 'Rock Salt', 'Special Elite',
  'Roboto', 'Open Sans', 'Lato', 'Raleway', 'Ubuntu', 'Nunito', 'Playfair Display', 'Merriweather', 'Lora',
  'PT Serif', 'Crimson Text', 'Libre Baskerville', 'Anton', 'Archivo Black', 'Alfa Slab One',
  'Black Ops One', 'Russo One', 'Passion One', 'Fjalla One', 'Monoton', 'Press Start 2P', 'Creepster',
  'Bungee', 'Acme', 'Patua One', 'Cinzel', 'Courgette', 'Indie Flower', 'Shadows Into Light', 'Amatic SC',
  'Kalam', 'Architects Daughter', 'Cookie', 'Allura', 'Tangerine', 'Pinyon Script', 'Courier New', 'Courier',
  'Times New Roman', 'Georgia', 'Verdana', 'Tahoma',
] as const;

export const STYLES_TEXTE = ['Normal', 'Gras', 'Italique', 'Gras italique'] as const;

export const MAX_TEXTES_PAR_LIGNE = 10;

export interface TexteManuel {
  texte: string;
  vue: string;
  police: string;
  style: string;
  /** Hauteur des lettres, en cm (null = non précisée). */
  taille: number | null;
}

/** Propriétés « Texte 1 », « Texte 2 »… d'une ligne. */
export const RE_TEXTE = /^Texte \d+$/;
/** Propriétés « Logo face », « Logo dos 2 »… d'une ligne (vue en minuscules). */
export const RE_LOGO = /^Logo (face|dos|cœur|manche droite|manche gauche)( \d+)?$/i;

const vueValide = (v: unknown): string | null => {
  const t = String(v ?? '').trim().toLowerCase();
  return VUES_MANUELLES.find((x) => x.toLowerCase() === t) ?? null;
};

/** Texte lisible pour l'atelier : « « MASSACRE » · Dos · Anton · Gras · 4 cm ». */
export function texteVersPropriete(t: TexteManuel): string {
  return [`« ${t.texte} »`, t.vue, t.police || 'Police libre', t.style, t.taille ? `${String(t.taille).replace('.', ',')} cm` : 'Taille libre'].join(' · ');
}

/** Inverse de texteVersPropriete (modification d'une commande). */
export function proprieteVersTexte(valeur: string): TexteManuel | null {
  const v = String(valeur ?? '');
  const fin = v.lastIndexOf(' »');
  if (!v.startsWith('« ') || fin < 2) return null;
  const [vue, police, style, taille] = v.slice(fin + 2).split(' · ').slice(1);
  return {
    texte: v.slice(2, fin),
    vue: vueValide(vue) ?? 'Face',
    police: police && police !== 'Police libre' ? police : '',
    style: (STYLES_TEXTE as readonly string[]).includes(style) ? style : 'Normal',
    taille: taille && /^[\d,]+ cm$/.test(taille) ? Number(taille.replace(' cm', '').replace(',', '.')) : null,
  };
}

/** Textes d'un article, validés ; les entrées sans texte sont ignorées. */
export function lireTextes(brut: unknown): { textes: TexteManuel[] } | { erreur: string } {
  const textes: TexteManuel[] = [];
  for (const t of (Array.isArray(brut) ? brut : []).slice(0, MAX_TEXTES_PAR_LIGNE)) {
    const texte = String((t as any)?.texte ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 200);
    if (!texte) continue;
    const vue = vueValide((t as any)?.vue);
    if (!vue) return { erreur: `Vue inconnue pour le texte « ${texte} ».` };
    const police = String((t as any)?.police ?? '').trim();
    if (police && !(POLICES_MANUELLES as readonly string[]).includes(police)) {
      return { erreur: `Police inconnue pour le texte « ${texte} ».` };
    }
    const style = String((t as any)?.style || 'Normal');
    if (!(STYLES_TEXTE as readonly string[]).includes(style)) return { erreur: `Style inconnu pour le texte « ${texte} ».` };
    const brutTaille = String((t as any)?.taille ?? '').replace(',', '.').trim();
    let taille: number | null = null;
    if (brutTaille) {
      const n = Number(brutTaille);
      if (!Number.isFinite(n) || n <= 0 || n > 200) return { erreur: `Taille invalide pour le texte « ${texte} » (en cm).` };
      taille = Math.round(n * 10) / 10;
    }
    textes.push({ texte, vue, police, style, taille });
  }
  return { textes };
}

/** Nom de propriété d'un logo : « Logo face », puis « Logo face 2 »… */
export function nomLogo(vue: string, dejaPresents: string[]): string {
  const base = `Logo ${vue.toLowerCase()}`;
  const n = dejaPresents.filter((p) => p === base || p.startsWith(base + ' ')).length;
  return n ? `${base} ${n + 1}` : base;
}

/** Logos DÉJÀ joints renvoyés par le formulaire de modification. */
export function logosConserves(brut: unknown): Array<{ url: string; vue: string }> {
  if (!Array.isArray(brut)) return [];
  return brut
    .map((l: any) => ({ url: String(l?.url ?? '').trim(), vue: vueValide(l?.vue) ?? '' }))
    .filter((l) => l.vue && /^https:\/\/res\.cloudinary\.com\/[^\s"'<>]+$/.test(l.url))
    .slice(0, MAX_DESIGNS_PAR_LIGNE);
}

/**
 * Données du formulaire pour MODIFIER une commande manuelle (inverse de
 * lireSaisieManuelle) : client, adresse, articles (détails, manches,
 * designs déjà joints), montant, date.
 */
export function formulaireDepuisCommande(o: {
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerInfo?: Record<string, any> | null;
  lineItems?: unknown[];
  totalPrice?: string | null;
  shopifyCreatedAt?: Date | string | null;
}): Record<string, unknown> {
  const s = (o.customerInfo?.shipping || {}) as Record<string, any>;
  const d = o.shopifyCreatedAt ? new Date(o.shopifyCreatedAt) : null;
  return {
    client: { nom: o.customerName || '', email: o.customerEmail || '', telephone: o.customerPhone || '' },
    adresse: { ligne1: s.address1 || '', codePostal: s.zip || '', ville: s.city || '', pays: s.country || '' },
    articles: (Array.isArray(o.lineItems) ? o.lineItems : []).map((li: any) => {
      const props: any[] = Array.isArray(li?.properties) ? li.properties : [];
      const nom = (p: any) => String(p?.name ?? '');
      return {
        titre: li?.title || '',
        quantite: li?.quantity || 1,
        details: props.filter((p) => /^Détail \d+$/.test(nom(p))).map((p) => String(p.value ?? '')).join('\n'),
        manches: props.filter((p) => /^Manche (droite|gauche)$/.test(nom(p))).map((p) => nom(p).slice(7)),
        designs: props.filter((p) => RE_DESIGN.test(nom(p))).map((p) => String(p.value ?? '')),
        textes: props
          .filter((p) => RE_TEXTE.test(nom(p)))
          .map((p) => proprieteVersTexte(String(p.value ?? '')))
          .filter(Boolean),
        logos: props
          .filter((p) => RE_LOGO.test(nom(p)))
          .map((p) => ({ url: String(p.value ?? ''), vue: vueValide(nom(p).match(RE_LOGO)?.[1]) ?? 'Face' })),
      };
    }),
    total: o.totalPrice || '',
    date: d && !isNaN(d.getTime()) ? d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }) : '',
  };
}

/**
 * Ressource Cloudinary d'un fichier d'une commande manuelle (dossier
 * `customizer/commandes/`), pour l'effacer avec la commande. null hors de ce
 * dossier : on n'efface jamais un fichier qui ne lui appartient pas.
 */
export function ressourceCommande(url: string): { publicId: string; resourceType: 'image' | 'raw' } | null {
  const m = String(url || '').match(/^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|raw)\/upload\/(?:v\d+\/)?(customizer\/commandes\/[^?#]+)$/);
  if (!m) return null;
  let chemin: string;
  try {
    chemin = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  const resourceType = m[1] as 'image' | 'raw';
  return { publicId: resourceType === 'raw' ? chemin : chemin.replace(/\.[a-zA-Z0-9]{1,5}$/, ''), resourceType };
}

export function avecDesign(
  lignes: unknown,
  index: number,
  url: string,
  /** Vue d'un LOGO (« Face », « Dos »…) ; absente pour un design. */
  vueLogo?: string,
): { lignes: Array<Record<string, any>> } | { erreur: string } {
  const copie: Array<Record<string, any>> = Array.isArray(lignes) ? lignes.map((l: any) => ({ ...l })) : [];
  const li = copie[index];
  if (!Number.isInteger(index) || !li) return { erreur: 'Article introuvable.' };
  const props = Array.isArray(li.properties) ? [...li.properties] : [];
  if (vueLogo !== undefined) {
    const vue = vueValide(vueLogo);
    if (!vue) return { erreur: 'Vue du logo inconnue.' };
    const noms = props.map((p: any) => String(p?.name ?? ''));
    if (noms.filter((p) => RE_LOGO.test(p)).length >= MAX_DESIGNS_PAR_LIGNE) {
      return { erreur: `${MAX_DESIGNS_PAR_LIGNE} logos au plus par article.` };
    }
    props.push({ name: nomLogo(vue, noms), value: url });
    li.properties = props;
    return { lignes: copie };
  }
  const n = props.filter((p: any) => /^Design( \d+)?$/.test(String(p?.name ?? ''))).length;
  if (n >= MAX_DESIGNS_PAR_LIGNE) return { erreur: `${MAX_DESIGNS_PAR_LIGNE} designs au plus par article.` };
  props.push({ name: n ? `Design ${n + 1}` : 'Design', value: url });
  li.properties = props;
  return { lignes: copie };
}

export interface SaisieManuelle {
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerInfo: Record<string, unknown>;
  lineItems: Array<Record<string, unknown>>;
  totalPrice: string | null;
  currency: string;
  financialStatus: string;
  shopifyCreatedAt: Date;
}

const ligne = (v: unknown, max: number): string =>
  String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valide et normalise la saisie du formulaire.
 * Renvoie `{ erreur }` au premier défaut, en français, prêt à afficher.
 */
export function lireSaisieManuelle(
  brut: unknown,
  maintenant: Date = new Date(),
): { saisie: SaisieManuelle } | { erreur: string } {
  const b = (brut && typeof brut === 'object' ? brut : {}) as Record<string, any>;
  const c = (b.client && typeof b.client === 'object' ? b.client : {}) as Record<string, any>;

  const nom = ligne(c.nom, 120);
  const entreprise = ligne(c.entreprise, 120);
  if (!nom && !entreprise) return { erreur: 'Indiquez le nom du client ou de son entreprise.' };
  const email = ligne(c.email, 200).toLowerCase();
  if (email && !EMAIL.test(email)) return { erreur: 'Adresse e-mail invalide.' };
  const telephone = ligne(c.telephone, 40);

  const articles: any[] = Array.isArray(b.articles) ? b.articles : [];
  const lignes: Array<Record<string, unknown>> = [];
  for (const a of articles.slice(0, MAX_LIGNES_MANUELLES + 1)) {
    const titre = ligne(a?.titre, 150);
    const details = String(a?.details ?? '')
      .split(/\r?\n/)
      .map((d) => ligne(d, 300))
      .filter(Boolean)
      .slice(0, 20);
    // Ligne laissée vide (la quantité vaut 1 par défaut : elle ne compte pas).
    if (!titre && !details.length) continue;
    if (!titre) return { erreur: "Choisissez l'article dans la liste." };
    if (!ARTICLES_MANUELS.includes(titre)) {
      return { erreur: `Article inconnu : « ${titre} ». Choisissez-le dans la liste.` };
    }
    const lt = lireTextes(a?.textes);
    if ('erreur' in lt) return { erreur: lt.erreur };
    const textesLus = lt.textes;
    const logosLus: Array<{ name: string; value: string }> = [];
    for (const l of logosConserves(a?.logos)) {
      logosLus.push({ name: nomLogo(l.vue, logosLus.map((x) => x.name)), value: l.url });
    }
    const qte = Number(a?.quantite);
    if (!Number.isInteger(qte) || qte < 1 || qte > 1_000_000) {
      return { erreur: `Quantité invalide pour « ${titre} ».` };
    }
    lignes.push({
      title: titre,
      variantTitle: null,
      quantity: qte,
      // Pas de prix par article : seul le montant total, saisi par l'admin, compte.
      price: '0.00',
      sku: null,
      productId: null,
      variantId: null,
      properties: [
        ...details.map((d, i) => ({ name: `Détail ${i + 1}`, value: d })),
        // Manches personnalisées (textiles seulement) : information pour l'atelier.
        ...manchesDe(titre, a?.manches).map((m) => ({ name: `Manche ${m}`, value: 'Personnalisée' })),
        // Designs DÉJÀ joints (modification d'une commande) : conservés tels
        // quels. Les nouveaux arrivent ensuite par la route « design ».
        ...designsConserves(a?.designs).map((url, i) => ({ name: i ? `Design ${i + 1}` : 'Design', value: url })),
        ...textesLus.map((t, i) => ({ name: `Texte ${i + 1}`, value: texteVersPropriete(t) })),
        ...logosLus,
      ],
    });
  }
  if (!lignes.length) return { erreur: 'Ajoutez au moins un article.' };
  if (lignes.length > MAX_LIGNES_MANUELLES) {
    return { erreur: `${MAX_LIGNES_MANUELLES} articles au plus par commande.` };
  }

  // Montant total TTC : SAISI par l'admin (montant réellement encaissé), il
  // n'est pas recalculé depuis les articles.
  const totalBrut = String(b.total ?? '').replace(/\s/g, '').replace(',', '.');
  if (!totalBrut) return { erreur: 'Indiquez le montant total TTC.' };
  const t = Number(totalBrut);
  if (!Number.isFinite(t) || t <= 0 || t > 10_000_000) return { erreur: 'Montant total invalide.' };
  const totalPrice = t.toFixed(2);

  // Commande manuelle = commande DÉJÀ PAYÉE hors boutique (virement, chèque,
  // bon de commande réglé…). Elle reste dans le dashboard : rien n'est créé
  // sur Shopify, aucun e-mail n'est envoyé — l'e-mail du client est facultatif.
  const paiement = 'paid';

  // Date de commande (AAAA-MM-JJ), à midi heure de Paris pour rester sur le bon
  // jour quelle que soit la conversion de fuseau ; aujourd'hui par défaut.
  let date = maintenant;
  const dateBrute = String(b.date || '').trim();
  if (dateBrute) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateBrute)) return { erreur: 'Date de commande invalide.' };
    const d = new Date(`${dateBrute}T12:00:00+02:00`);
    if (isNaN(d.getTime())) return { erreur: 'Date de commande invalide.' };
    if (d.getTime() > maintenant.getTime() + 2 * 86_400_000) {
      return { erreur: 'La date de commande est dans le futur.' };
    }
    date = d;
  }

  const adresse = (b.adresse && typeof b.adresse === 'object' ? b.adresse : {}) as Record<string, any>;
  const shipping = {
    name: nom || entreprise,
    company: entreprise || null,
    address1: ligne(adresse.ligne1, 200) || null,
    address2: ligne(adresse.ligne2, 200) || null,
    zip: ligne(adresse.codePostal, 20) || null,
    city: ligne(adresse.ville, 100) || null,
    province: null,
    country: ligne(adresse.pays, 60) || null,
    phone: telephone || null,
  };
  const aUneAdresse = !!(shipping.address1 || shipping.zip || shipping.city);

  return {
    saisie: {
      customerName: nom || entreprise,
      customerEmail: email || null,
      customerPhone: telephone || null,
      customerInfo: {
        email: email || null,
        phone: telephone || null,
        note: null,
        shipping: aUneAdresse ? shipping : null,
        billing: null,
        manuelle: true,
      },
      lineItems: lignes,
      totalPrice,
      currency: 'EUR',
      financialStatus: paiement,
      shopifyCreatedAt: date,
    },
  };
}


/** Identifiant de commande manuelle porté par une ligne Shopify (propriété cachée), ou null. */
export function commandeManuelleDeLignes(lignes: unknown): string | null {
  for (const li of Array.isArray(lignes) ? lignes : []) {
    for (const p of Array.isArray((li as any)?.properties) ? (li as any).properties : []) {
      if (RE_PROPRIETE_COMMANDE_MANUELLE.test(String(p?.name ?? '')) && estCommandeManuelle(String(p?.value ?? '').trim())) {
        return String(p.value).trim();
      }
    }
  }
  return null;
}
