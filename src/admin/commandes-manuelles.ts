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
export const STATUTS_PAIEMENT_MANUELS = ['paid', 'pending'] as const;

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

  let totalPrice: string | null = null;
  const totalBrut = String(b.total ?? '').replace(/\s/g, '').replace(',', '.');
  if (totalBrut) {
    const t = Number(totalBrut);
    if (!Number.isFinite(t) || t < 0 || t > 10_000_000) return { erreur: 'Montant total invalide.' };
    totalPrice = t.toFixed(2);
  }

  const paiement = String(b.paiement || 'pending');
  if (!(STATUTS_PAIEMENT_MANUELS as readonly string[]).includes(paiement)) {
    return { erreur: 'Statut de paiement inconnu.' };
  }

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

/** Données du formulaire pour MODIFIER une commande manuelle (inverse de lireSaisieManuelle). */
export function formulaireDepuisCommande(o: {
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerInfo?: Record<string, any> | null;
  lineItems?: unknown[];
  totalPrice?: string | null;
  financialStatus?: string | null;
  shopifyCreatedAt?: Date | string | null;
}): Record<string, unknown> {
  const s = (o.customerInfo?.shipping || {}) as Record<string, any>;
  const d = o.shopifyCreatedAt ? new Date(o.shopifyCreatedAt) : null;
  return {
    client: {
      nom: s.company && s.name === s.company ? '' : o.customerName || '',
      entreprise: s.company || '',
      email: o.customerEmail || '',
      telephone: o.customerPhone || '',
    },
    adresse: {
      ligne1: s.address1 || '',
      ligne2: s.address2 || '',
      codePostal: s.zip || '',
      ville: s.city || '',
      pays: s.country || '',
    },
    articles: (Array.isArray(o.lineItems) ? o.lineItems : []).map((li: any) => ({
      titre: li?.title || '',
      quantite: li?.quantity || 1,
      details: (Array.isArray(li?.properties) ? li.properties : [])
        .map((p: any) => String(p?.value ?? ''))
        .join('\n'),
    })),
    total: o.totalPrice || '',
    paiement: o.financialStatus === 'paid' ? 'paid' : 'pending',
    date: d && !isNaN(d.getTime()) ? d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }) : '',
  };
}
