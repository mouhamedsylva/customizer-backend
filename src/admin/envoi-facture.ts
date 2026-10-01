/**
 * ENVOI DE FACTURE — que faire quand `send_invoice` échoue ?
 *
 * Un REFUS NET de Shopify (4xx : brouillon introuvable, e-mail invalide…)
 * garantit que rien n'est parti : on peut remettre le brouillon à son état
 * d'avant.
 *
 * Un délai dépassé, une coupure réseau ou un 5xx, en revanche, ne disent RIEN
 * de l'e-mail : Shopify a pu l'envoyer avant que la réponse ne se perde. Y
 * remettre l'ancien prix donnait au client un lien de paiement à l'ancien
 * montant — souvent 0 € au premier chiffrage. Dans ce cas on n'annule rien et
 * on relit le brouillon pour savoir si la facture est partie.
 */

/** Statut HTTP d'une erreur levée par ShopifyService (« Erreur Shopify (422) … »). */
export function statutErreurShopify(err: unknown): number | null {
  const m = String((err as Error)?.message ?? '').match(/Erreur Shopify \((\d{3})\)/);
  return m ? Number(m[1]) : null;
}

/** L'e-mail a-t-il PU partir malgré l'erreur ? Faux seulement sur un refus 4xx. */
export function envoiPeutEtrePasse(err: unknown): boolean {
  /* Échec d'obtention du jeton OAuth : levé AVANT toute requête d'envoi,
     donc rien n'est parti. */
  if (/^(Jeton Shopify refusé|Accès Shopify non configuré|Réponse OAuth Shopify)/.test(
    String((err as Error)?.message ?? ''),
  )) return false;
  const statut = statutErreurShopify(err);
  return statut === null || statut >= 500;
}

/**
 * Le brouillon relu montre-t-il une facture envoyée PENDANT cette tentative ?
 * `invoice_sent_at` est comparé au début de la tentative (moins une marge pour
 * le décalage d'horloge) : un brouillon déjà facturé lors d'un envoi précédent
 * est à `invoice_sent` depuis longtemps, ce qui ne prouve rien.
 */
export function factureEnvoyeeDepuis(
  draft: { invoice_sent_at?: unknown } | null | undefined,
  debut: Date,
  /** `invoice_sent_at` lu AVANT cette tentative (envoi précédent), s'il existe. */
  precedent?: unknown,
  margeMs = 2 * 60 * 1000,
): boolean {
  const t = Date.parse(String(draft?.invoice_sent_at ?? ''));
  if (!Number.isFinite(t)) return false;
  /* Renvoi rapide (prix corrigé < 2 min après le premier envoi) : la marge
     seule prenait la date du PREMIER envoi pour une confirmation. Il faut une
     date STRICTEMENT postérieure à celle d'avant la tentative. */
  const avant = Date.parse(String(precedent ?? ''));
  if (Number.isFinite(avant) && t <= avant) return false;
  return t >= debut.getTime() - margeMs;
}
