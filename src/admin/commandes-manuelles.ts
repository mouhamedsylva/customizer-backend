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
/** « facture » : e-mail de paiement au client ; « payee » : déjà réglée hors boutique. */
export const MODES_FACTURATION = ['facture', 'payee'] as const;
export type ModeFacturation = (typeof MODES_FACTURATION)[number];

/**
 * Propriété CACHÉE (le « _ » la masque au client) posée sur chaque ligne du
 * brouillon Shopify : elle porte l'identifiant de la commande manuelle. Quand
 * le client paie, la commande Shopify qui en naît la porte encore — c'est elle
 * qui permet de lui transférer fichiers, note et suivi (webhooks.service.ts).
 */
export const PROPRIETE_COMMANDE_MANUELLE = '_Commande manuelle';
export const RE_PROPRIETE_COMMANDE_MANUELLE = /^_?Commande manuelle$/i;

/** Suggestions d'articles (libres) : le titre détermine la famille de filtre. */
export const ARTICLES_SUGGERES = [
  'Patch personnalisé (PVC)',
  'Patch personnalisé (brodé)',
  'Patch personnalisé (tissé)',
  'Coin métal personnalisé',
  'Drapeau personnalisé',
  'T-shirt coton personnalisé',
  'T-shirt polyester personnalisé',
  'Sweatshirt personnalisé',
];

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
): { saisie: SaisieManuelle; mode: ModeFacturation } | { erreur: string } {
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
    if (!titre && !details.length && !a?.quantite) continue; // ligne laissée vide
    if (!titre) return { erreur: 'Chaque article doit avoir un nom.' };
    const qte = Number(a?.quantite);
    if (!Number.isInteger(qte) || qte < 1 || qte > 1_000_000) {
      return { erreur: `Quantité invalide pour « ${titre} ».` };
    }
    lignes.push({
      title: titre,
      variantTitle: null,
      quantity: qte,
      price: '0.00',
      sku: null,
      productId: null,
      variantId: null,
      properties: details.map((d, i) => ({ name: `Détail ${i + 1}`, value: d })),
    });
  }
  if (!lignes.length) return { erreur: 'Ajoutez au moins un article.' };
  if (lignes.length > MAX_LIGNES_MANUELLES) {
    return { erreur: `${MAX_LIGNES_MANUELLES} articles au plus par commande.` };
  }

  // Montant TTC OBLIGATOIRE : il devient le prix du brouillon Shopify, réparti
  // entre les articles (voir facturerCommandeManuelle).
  const totalBrut = String(b.total ?? '').replace(/\s/g, '').replace(',', '.');
  if (!totalBrut) return { erreur: 'Indiquez le montant total TTC.' };
  const t = Number(totalBrut);
  if (!Number.isFinite(t) || t <= 0 || t > 10_000_000) return { erreur: 'Montant total invalide.' };
  const totalPrice = t.toFixed(2);

  // « facture » : e-mail de paiement envoyé au client ; « payee » : paiement
  // déjà reçu (virement, chèque…), commande Shopify validée comme payée.
  const mode = String(b.mode || 'facture');
  if (!(MODES_FACTURATION as readonly string[]).includes(mode)) {
    return { erreur: 'Mode de paiement inconnu.' };
  }
  if (mode === 'facture' && !email) {
    return { erreur: "Indiquez l'e-mail du client : la facture lui est envoyée." };
  }
  const paiement = mode === 'payee' ? 'paid' : 'pending';

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
    mode: mode as ModeFacturation,
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


/** Suivi de la facturation Shopify, rangé dans `customerInfo.facture`. */
export interface FactureManuelle {
  draftOrderId?: string;
  statut: 'envoyee' | 'echec' | 'payee';
  /** ISO : date de l'envoi, de la validation ou de l'échec. */
  le: string;
  total?: string;
  erreur?: string;
  orderId?: string;
}

/** Suivi de facture d'une commande manuelle, ou null s'il n'y en a pas encore. */
export function factureDe(o: { customerInfo?: Record<string, any> | null }): FactureManuelle | null {
  const f = o.customerInfo?.facture;
  return f && typeof f === 'object' && typeof f.statut === 'string' ? (f as FactureManuelle) : null;
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

/**
 * Brouillon Shopify d'une commande manuelle. Lignes personnalisées à 0,00 €
 * (le prix est posé ensuite par setDraftOrderPrice, qui répartit le total au
 * centime) : elles ne touchent pas au stock.
 */
export function brouillonDepuisManuelle(o: {
  shopifyOrderId: string;
  orderNumber?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerInfo?: Record<string, any> | null;
  lineItems?: unknown[];
}): {
  line_items: Array<{ title: string; quantity: number; price: string; custom: true; properties: Array<{ name: string; value: string }> }>;
  customer?: { email?: string; first_name?: string; last_name?: string; phone?: string };
  email?: string;
  note: string;
  tags: string;
  shipping_address?: Record<string, string>;
} {
  const numero = o.orderNumber || numeroManuel(String(o.shopifyOrderId));
  const s = (o.customerInfo?.shipping || null) as Record<string, any> | null;
  // « Julien Lucas » → prénom « Julien », nom « Lucas » ; un mot seul → nom.
  const mots = String(o.customerName || '').trim().split(/\s+/).filter(Boolean);
  const prenom = mots.length > 1 ? mots.slice(0, -1).join(' ') : '';
  const nomFamille = mots.length ? mots[mots.length - 1] : '';
  const sansVide = (r: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined && v !== '')) as Record<string, string>;

  return {
    line_items: (Array.isArray(o.lineItems) ? o.lineItems : []).map((li: any) => ({
      title: String(li?.title || 'Article'),
      quantity: Math.max(1, Number(li?.quantity) || 1),
      price: '0.00',
      custom: true as const,
      properties: [
        ...(Array.isArray(li?.properties) ? li.properties : [])
          .filter((p: any) => p?.name && p?.value)
          .map((p: any) => ({ name: String(p.name), value: String(p.value) })),
        { name: PROPRIETE_COMMANDE_MANUELLE, value: String(o.shopifyOrderId) },
      ],
    })),
    ...(o.customerEmail
      ? {
          email: o.customerEmail,
          customer: sansVide({ email: o.customerEmail, first_name: prenom, last_name: nomFamille, phone: o.customerPhone }),
        }
      : {}),
    note: `COMMANDE MANUELLE ${numero} (saisie dans le dashboard)`,
    tags: 'manuelle, dashboard',
    ...(s
      ? {
          shipping_address: sansVide({
            first_name: prenom,
            last_name: nomFamille || s.name,
            company: s.company,
            address1: s.address1,
            address2: s.address2,
            zip: s.zip,
            city: s.city,
            country: s.country,
            phone: s.phone,
          }),
        }
      : {}),
  };
}
