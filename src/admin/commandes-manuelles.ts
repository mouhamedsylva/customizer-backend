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
export function avecDesign(
  lignes: unknown,
  index: number,
  url: string,
): { lignes: Array<Record<string, any>> } | { erreur: string } {
  const copie: Array<Record<string, any>> = Array.isArray(lignes) ? lignes.map((l: any) => ({ ...l })) : [];
  const li = copie[index];
  if (!Number.isInteger(index) || !li) return { erreur: 'Article introuvable.' };
  const props = Array.isArray(li.properties) ? [...li.properties] : [];
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
        // Manches personnalisées (textiles seulement) : leur supplément est
        // déjà compris dans le prix unitaire ; la propriété sert à l'atelier.
        ...manchesDe(titre, a?.manches).map((m) => ({ name: `Manche ${m}`, value: 'Personnalisée' })),
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
