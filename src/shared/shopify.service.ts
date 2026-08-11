import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Ligne d'article pour un draft order Shopify.
 * `custom: true` permet de creer une ligne sans variant existant (produit personnalise).
 *
 * Les trois derniers champs sont PRÉSERVÉS lors de toute reconstruction de
 * ligne. Les omettre — ce que faisait le code — avait deux effets silencieux :
 * une remise commerciale accordée sur le brouillon disparaissait, et une ligne
 * volontairement exonérée redevenait `taxable: true` (défaut Shopify), faisant
 * réapparaître la TVA sur la facture.
 */
export interface ShopifyLineItem {
  title?: string;
  variant_id?: number | string;
  price?: string;
  quantity: number;
  custom?: boolean;
  properties?: Array<{ name: string; value: string }>;
  applied_discount?: Record<string, unknown>;
  taxable?: boolean;
  requires_shipping?: boolean;
}

export interface DraftOrderCustomer {
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

export interface CreateDraftOrderPayload {
  line_items: ShopifyLineItem[];
  customer?: DraftOrderCustomer;
  email?: string;
  note?: string;
  tags?: string;
}

/**
 * Service d'integration avec l'API Admin Shopify.
 * Adapte depuis l'ancien customizer-api/src/services/shopify.service.js.
 * Utilise fetch natif (Node 18+/20).
 */
@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);

  constructor(private readonly config: ConfigService) {}

  /** URL de base de l'API Admin Shopify. */
  private getBaseUrl(): string {
    const storeUrl = this.config.get<string>('SHOPIFY_STORE_URL');
    const apiVersion =
      this.config.get<string>('SHOPIFY_API_VERSION') || '2024-01';
    return `https://${storeUrl}/admin/api/${apiVersion}`;
  }

  /* ── Jeton d'accès Admin ─────────────────────────────────────────────────
     Depuis janvier 2026, Shopify ne délivre plus de jeton PERMANENT : les
     applications du Dev Dashboard s'authentifient par `client_credentials` et
     reçoivent un jeton valable 24 h (mesuré : `expires_in` = 86399).

     Ce service doit donc l'obtenir puis le renouveler lui-même. Le jeton est
     gardé en mémoire — pas en base : un redémarrage en redemande un, ce qui
     coûte un aller-retour et évite de stocker un secret de plus.

     `SHOPIFY_ACCESS_TOKEN` reste prioritaire s'il est renseigné : il couvre les
     jetons « legacy » (permanents, créés avant 2026) et le test ponctuel avec
     un jeton collé à la main. Sans lui, on passe par client_credentials. */

  /** Jeton courant et son échéance (ms epoch). */
  private jeton: string | null = null;
  private jetonExpireA = 0;

  /** Échange en cours, s'il y en a un. Voir obtenirJeton(). */
  private jetonEnCours: Promise<string> | null = null;

  /* Marge avant expiration. Un jeton renouvelé pile à l'échéance serait déjà
     refusé par une requête partie une seconde plus tôt : on anticipe. */
  private static readonly MARGE_MS = 5 * 60 * 1000;

  /**
   * Jeton Admin valide, renouvelé au besoin.
   *
   * Les appels concurrents partagent une SEULE promesse : au démarrage, une
   * dizaine de requêtes simultanées déclencheraient sinon autant d'échanges
   * OAuth — inutiles, et susceptibles de heurter une limite de débit.
   */
  private async obtenirJeton(): Promise<string> {
    const fixe = this.config.get<string>('SHOPIFY_ACCESS_TOKEN');
    if (fixe) return fixe;

    if (this.jeton && Date.now() < this.jetonExpireA) return this.jeton;
    if (this.jetonEnCours) return this.jetonEnCours;

    this.jetonEnCours = this.echangerIdentifiants().finally(() => {
      this.jetonEnCours = null;
    });
    return this.jetonEnCours;
  }

  /** Échange client_id + client_secret contre un jeton (flux OAuth Shopify). */
  private async echangerIdentifiants(): Promise<string> {
    const store = this.config.get<string>('SHOPIFY_STORE_URL');
    const id = this.config.get<string>('SHOPIFY_CLIENT_ID');
    const secret = this.config.get<string>('SHOPIFY_CLIENT_SECRET');

    if (!store || !id || !secret) {
      throw new Error(
        'Accès Shopify non configuré : renseignez SHOPIFY_CLIENT_ID et ' +
          'SHOPIFY_CLIENT_SECRET (application du Dev Dashboard), ou ' +
          'SHOPIFY_ACCESS_TOKEN pour un jeton permanent.',
      );
    }

    const res = await fetch(`https://${store}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: id,
        client_secret: secret,
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(ShopifyService.TIMEOUT_MS),
    });

    if (!res.ok) {
      /* `app_not_installed` est l'erreur la plus probable et la moins parlante :
         l'application existe dans le Dev Dashboard mais n'est pas installée sur
         la boutique. On remonte le corps tel quel pour ne pas masquer la cause. */
      const corps = await res.text().catch(() => '');
      throw new Error(
        `Jeton Shopify refusé (HTTP ${res.status}) : ${corps.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!data.access_token) {
      throw new Error('Réponse OAuth Shopify sans access_token.');
    }

    /* Un jeton sans portée est délivré NORMALEMENT (HTTP 200) mais se heurte à
       un 403 sur le premier appel réel. La cause est toujours la même : les
       portées ne sont pas déclarées dans la version PUBLIÉE de l'application.
       On le signale ici, sinon le diagnostic se fait sur un 403 sans contexte. */
    if (!data.scope) {
      this.logger.error(
        'Jeton Shopify obtenu SANS AUCUNE PORTÉE : les appels renverront 403. ' +
          "Déclarez les portées dans la version publiée de l'application " +
          '(Dev Dashboard → Versions), puis publiez-la.',
      );
    }

    const dureeS = Number(data.expires_in) || 86400;
    this.jeton = data.access_token;
    this.jetonExpireA = Date.now() + dureeS * 1000 - ShopifyService.MARGE_MS;
    this.logger.log(
      `Jeton Shopify obtenu (valable ${Math.round(dureeS / 3600)} h, portées : ${
        data.scope || 'AUCUNE'
      }).`,
    );
    return this.jeton;
  }

  /** Headers authentifies pour Shopify. */
  private async getHeaders(): Promise<Record<string, string>> {
    return {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': await this.obtenirJeton(),
    };
  }

  /** Délai au-delà duquel un appel Shopify est abandonné. */
  private static readonly TIMEOUT_MS = 20000;

  /**
   * Nombre de RÉESSAIS après un 429 (donc 3 tentatives au total).
   *
   * Shopify applique un seau percé d'environ 2 requêtes/seconde : le quota se
   * régénère en continu, un rejet est donc presque toujours transitoire.
   * Au-delà de 3 essais on abandonne — mieux vaut un échec signalé qu'une
   * requête HTTP retenue plusieurs minutes.
   */
  private static readonly MAX_RETRIES = 2;

  /** Attente de repli quand Shopify n'envoie pas d'en-tête `Retry-After`. */
  private static readonly BACKOFF_MS = [1000, 2000];

  /** Pause simple, utilisée entre deux tentatives. */
  private wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * `fetch` borné dans le temps, avec réessai sur quota dépassé.
   *
   * Deux protections distinctes :
   *
   * 1. TIMEOUT — le `fetch` natif de Node n'en a AUCUN par défaut : un appel
   *    qui pend bloque son appelant indéfiniment. Côté synchro périodique,
   *    cela gèle le verrou anti-chevauchement et fige les passes suivantes.
   *
   * 2. QUOTA (429) — Shopify plafonne à ~2 requêtes/seconde. Sans réessai, un
   *    dépassement remontait comme une erreur fatale à TOUS les appelants à la
   *    fois : prix non synchronisés, statuts d'expédition figés, relances
   *    perdues. Or un 429 signifie « trop tôt », pas « impossible » : on
   *    respecte le `Retry-After` de Shopify quand il est fourni, sinon on
   *    patiente 1 s puis 2 s.
   *
   * Seul le 429 est rejoué. Un 5xx peut correspondre à une écriture déjà
   * appliquée côté Shopify : la rejouer créerait un doublon (une commande
   * expédiée deux fois, un brouillon en double).
   */
  private async fetchShopify(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(ShopifyService.TIMEOUT_MS),
        });
      } catch (e) {
        // `AbortSignal.timeout` lève une TimeoutError peu parlante : on la
        // reformule pour que le message loggué désigne la cause réelle.
        if ((e as Error)?.name === 'TimeoutError') {
          throw new Error(
            `Shopify n'a pas répondu en ${ShopifyService.TIMEOUT_MS / 1000}s : ${url}`,
          );
        }
        throw e;
      }

      if (response.status !== 429 || attempt >= ShopifyService.MAX_RETRIES) {
        return response;
      }

      // `Retry-After` est en SECONDES. On le borne à 10 s : une valeur
      // aberrante retiendrait la requête bien au-delà du raisonnable.
      const header = Number(response.headers.get('retry-after'));
      const delay =
        Number.isFinite(header) && header > 0
          ? Math.min(header * 1000, 10000)
          : ShopifyService.BACKOFF_MS[attempt];

      this.logger.warn(
        `Quota Shopify atteint (429) : nouvelle tentative dans ${delay} ms ` +
          `(${attempt + 1}/${ShopifyService.MAX_RETRIES}) — ${url}`,
      );
      await this.wait(delay);
    }
  }

  /**
   * Cree un draft order Shopify.
   * Retourne l'objet draft_order tel que renvoye par Shopify.
   */
  async createDraftOrder(
    payload: CreateDraftOrderPayload,
  ): Promise<Record<string, any>> {
    const body = { draft_order: payload };

    const response = await this.fetchShopify(`${this.getBaseUrl()}/draft_orders.json`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.error(`Echec creation draft order: ${response.status} ${text}`);
      throw new Error(
        `Erreur Shopify (${response.status}): ${response.statusText}`,
      );
    }

    const result = (await response.json()) as { draft_order: Record<string, any> };
    return result.draft_order;
  }

  /**
   * Recupere un draft order par son id.
   */
  async getDraftOrder(draftOrderId: string | number): Promise<Record<string, any>> {
    const response = await this.fetchShopify(
      `${this.getBaseUrl()}/draft_orders/${draftOrderId}.json`,
      { method: 'GET', headers: await this.getHeaders() },
    );

    if (!response.ok) {
      throw new Error(
        `Erreur Shopify (${response.status}): ${response.statusText}`,
      );
    }

    const result = (await response.json()) as { draft_order: Record<string, any> };
    return result.draft_order;
  }

  /**
   * Envoie la facture d'un draft order au client (même action que le bouton
   * « Envoyer la facture » de l'admin Shopify).
   * Le client reçoit un e-mail avec un lien de paiement.
   */
  async sendDraftOrderInvoice(
    draftOrderId: string | number,
    invoice: {
      to?: string;
      subject?: string;
      custom_message?: string;
      bcc?: string[];
    } = {},
  ): Promise<Record<string, any>> {
    const response = await this.fetchShopify(
      `${this.getBaseUrl()}/draft_orders/${draftOrderId}/send_invoice.json`,
      {
        method: 'POST',
        headers: await this.getHeaders(),
        body: JSON.stringify({ draft_order_invoice: invoice }),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.error(
        `Echec envoi facture draft ${draftOrderId}: ${response.status} ${text}`,
      );
      throw new Error(
        `Erreur Shopify (${response.status}) : ${response.statusText}. ${text}`,
      );
    }

    const result = (await response.json()) as {
      draft_order_invoice: Record<string, any>;
    };
    return result.draft_order_invoice;
  }

  /**
   * Liste les draft orders (limite configurable).
   */
  async listDraftOrders(limit = 50): Promise<Record<string, any>[]> {
    const response = await this.fetchShopify(
      `${this.getBaseUrl()}/draft_orders.json?limit=${limit}`,
      { method: 'GET', headers: await this.getHeaders() },
    );

    if (!response.ok) {
      throw new Error(
        `Erreur Shopify (${response.status}): ${response.statusText}`,
      );
    }

    const result = (await response.json()) as {
      draft_orders: Record<string, any>[];
    };
    return result.draft_orders || [];
  }

  /**
   * URL de la page suivante, extraite de l'en-tête `Link` renvoyé par Shopify.
   *
   * Format : `<https://…/orders.json?page_info=xyz>; rel="next"` — parfois
   * précédé d'un `rel="previous"`. Le `page_info` est opaque et porte déjà
   * tous les filtres de la requête initiale : Shopify REFUSE qu'on les
   * répète, d'où l'usage de l'URL telle quelle.
   */
  private nextPageUrl(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    for (const part of linkHeader.split(',')) {
      const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
      if (match) return match[1];
    }
    return null;
  }

  /**
   * Liste les VRAIES commandes (payées/passées) — pour l'import historique.
   * Nécessite le scope read_orders sur le token d'accès.
   * status=any inclut les commandes ouvertes, fermées et annulées.
   *
   * `updatedAtMin` (ISO 8601) restreint aux commandes modifiées depuis cette
   * date : la synchro périodique s'en sert pour ne pas rejouer les mêmes
   * commandes à chaque passage.
   *
   * Suit la pagination `Link` de Shopify — sans quoi l'historique s'arrêtait
   * aux `limit` dernières commandes et les plus anciennes n'étaient jamais
   * rattrapées. `maxPages` borne la durée d'une passe (250 × 20 = 5 000
   * commandes).
   *
   * `truncated` signale qu'il restait des pages : l'appelant DOIT alors
   * s'abstenir d'avancer sa fenêtre de synchro, sinon les commandes non lues
   * sortent définitivement de la plage demandée au tour suivant.
   */
  async listOrders(
    limit = 250,
    updatedAtMin?: string,
    maxPages = 20,
  ): Promise<{ orders: Record<string, any>[]; truncated: boolean }> {
    const params = new URLSearchParams({
      status: 'any',
      limit: String(limit),
    });
    if (updatedAtMin) params.set('updated_at_min', updatedAtMin);

    let url: string | null = `${this.getBaseUrl()}/orders.json?${params.toString()}`;
    const all: Record<string, any>[] = [];
    let truncated = false;

    for (let page = 0; url && page < maxPages; page++) {
      const response: Response = await this.fetchShopify(url, {
        method: 'GET',
        headers: await this.getHeaders(),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `Erreur Shopify (${response.status}) sur /orders : ${response.statusText}. ${text}`,
        );
      }

      const result = (await response.json()) as {
        orders?: Record<string, any>[];
      };
      all.push(...(result.orders || []));

      url = this.nextPageUrl(response.headers.get('link'));
      if (url && page === maxPages - 1) {
        truncated = true;
        this.logger.warn(
          `Pagination /orders interrompue après ${maxPages} pages ` +
            `(${all.length} commandes) : la fenêtre de synchro reste ouverte ` +
            `pour reprendre les plus anciennes au prochain passage.`,
        );
      }
    }

    return { orders: all, truncated };
  }

  /**
   * Fulfillment orders d'une commande.
   * Shopify n'accepte plus la création d'un fulfillment directement sur la
   * commande : il faut passer par ses « fulfillment orders » (un par lieu de
   * stock). On ne garde que ceux qui restent à traiter.
   * Nécessite le scope read_merchant_managed_fulfillment_orders.
   */
  async getFulfillmentOrders(
    orderId: string | number,
  ): Promise<Record<string, any>[]> {
    const response = await this.fetchShopify(
      `${this.getBaseUrl()}/orders/${orderId}/fulfillment_orders.json`,
      { method: 'GET', headers: await this.getHeaders() },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Erreur Shopify (${response.status}) sur /fulfillment_orders : ${response.statusText}. ${text}`,
      );
    }

    const result = (await response.json()) as {
      fulfillment_orders: Record<string, any>[];
    };
    return result.fulfillment_orders || [];
  }

  /**
   * Bascule les fulfillment orders d'une commande en « in_progress »
   * (« En préparation » côté Shopify). Sans effet si tout est déjà traité.
   *
   * Contrairement à l'expédition, ce changement N'ENVOIE PAS d'e-mail au
   * client : c'est un statut de préparation interne à la boutique.
   */
  async markInProgress(
    orderId: string | number,
  ): Promise<{ moved: number }> {
    const fos = await this.getFulfillmentOrders(orderId);
    const open = fos.filter((fo) => fo.status === 'open');
    let moved = 0;

    for (const fo of open) {
      const response = await this.fetchShopify(
        `${this.getBaseUrl()}/fulfillment_orders/${fo.id}/move.json`,
        {
          method: 'POST',
          headers: await this.getHeaders(),
          body: JSON.stringify({
            fulfillment_order: { new_location_id: fo.assigned_location_id },
          }),
        },
      );
      // Le déplacement échoue si le lieu est identique : ce n'est pas grave,
      // Shopify passe de toute façon le FO « in_progress » dès qu'un
      // fulfillment partiel existe. On ne bloque pas là-dessus.
      if (response.ok) moved++;
    }
    return { moved };
  }

  /**
   * Statut d'exécution réel d'une commande, tel que Shopify le voit.
   * `fulfillment_status` de la commande ne connaît que null | partial |
   * fulfilled — il ignore « en préparation ». Ce dernier vit sur les
   * fulfillment orders, d'où cette lecture combinée.
   */
  async getShippingState(
    orderId: string | number,
  ): Promise<'unfulfilled' | 'in_progress' | 'fulfilled' | 'partial'> {
    const fos = await this.getFulfillmentOrders(orderId);
    if (!fos.length) return 'unfulfilled';

    const statuses = fos.map((fo) => String(fo.status));
    const allClosed = statuses.every(
      (s) => s === 'closed' || s === 'cancelled' || s === 'incomplete',
    );
    if (allClosed) return 'fulfilled';
    if (statuses.some((s) => s === 'closed')) return 'partial';
    if (statuses.some((s) => s === 'in_progress')) return 'in_progress';
    return 'unfulfilled';
  }

  /**
   * Marque une commande comme expédiée dans Shopify.
   *
   * Effet côté client : Shopify lui envoie SON e-mail d'expédition (avec le
   * suivi s'il est fourni). L'action est donc visible du client et n'est pas
   * silencieuse — d'où la confirmation demandée côté dashboard.
   *
   * @param notifyCustomer  false pour expédier sans prévenir le client.
   * @returns le nombre de fulfillments créés (0 si tout était déjà traité).
   * Nécessite le scope write_merchant_managed_fulfillment_orders.
   */
  async fulfillOrder(
    orderId: string | number,
    opts: {
      trackingNumber?: string;
      trackingCompany?: string;
      trackingUrl?: string;
      notifyCustomer?: boolean;
    } = {},
  ): Promise<{ created: number; alreadyFulfilled: boolean }> {
    const fos = await this.getFulfillmentOrders(orderId);

    // Seuls les fulfillment orders encore ouverts peuvent être traités.
    const open = fos.filter(
      (fo) => fo.status === 'open' || fo.status === 'in_progress',
    );
    if (!open.length) {
      // Rien à faire : commande déjà expédiée, ou sans article à expédier.
      return { created: 0, alreadyFulfilled: fos.length > 0 };
    }

    const tracking =
      opts.trackingNumber || opts.trackingUrl
        ? {
            number: opts.trackingNumber || undefined,
            company: opts.trackingCompany || undefined,
            url: opts.trackingUrl || undefined,
          }
        : undefined;

    let created = 0;
    for (const fo of open) {
      const body: Record<string, any> = {
        fulfillment: {
          line_items_by_fulfillment_order: [{ fulfillment_order_id: fo.id }],
          notify_customer: opts.notifyCustomer !== false,
        },
      };
      if (tracking) body.fulfillment.tracking_info = tracking;

      const response = await this.fetchShopify(`${this.getBaseUrl()}/fulfillments.json`, {
        method: 'POST',
        headers: await this.getHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.logger.error(
          `Echec fulfillment commande ${orderId} (FO ${fo.id}): ${response.status} ${text}`,
        );
        throw new Error(
          `Erreur Shopify (${response.status}) : ${response.statusText}. ${text}`,
        );
      }
      created++;
    }

    this.logger.log(
      `Commande ${orderId} marquée expédiée dans Shopify (${created} fulfillment(s)).`,
    );
    return { created, alreadyFulfilled: false };
  }

  /**
   * Met a jour les line_items d'un draft order (remplace la liste complete).
   * Utilise pour ajouter/retirer une ligne cote panier.
   */
  async updateDraftOrderLineItems(
    draftOrderId: string | number,
    lineItems: ShopifyLineItem[],
  ): Promise<Record<string, any>> {
    const response = await this.fetchShopify(
      `${this.getBaseUrl()}/draft_orders/${draftOrderId}.json`,
      {
        method: 'PUT',
        headers: await this.getHeaders(),
        body: JSON.stringify({ draft_order: { line_items: lineItems } }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Erreur Shopify (${response.status}): ${response.statusText}`,
      );
    }

    const result = (await response.json()) as { draft_order: Record<string, any> };
    return result.draft_order;
  }

  /**
   * Définit le PRIX UNITAIRE de la ligne d'un draft order (devis).
   * Un devis n'a qu'une ligne : on la reconstruit avec le nouveau prix, en
   * conservant titre, quantité et propriétés (détails du design).
   * Renvoie le draft mis à jour (avec total_price recalculé par Shopify).
   */
  async setDraftOrderPrice(
    draftOrderId: string | number,
    unitPrice: number,
  ): Promise<Record<string, any>> {
    const draft = await this.getDraftOrder(draftOrderId);
    const items: Array<Record<string, any>> = Array.isArray(draft.line_items)
      ? draft.line_items
      : [];
    if (!items.length) {
      throw new Error('Ce brouillon ne contient aucune ligne.');
    }

    // Le prix unitaire saisi par l'équipe s'applique à TOUTES les lignes.
    //
    // Il n'était appliqué qu'à la ligne 0, sous l'hypothèse « un devis = une
    // ligne ». Les commandes de GROUPE ont invalidé cette hypothèse : elles
    // génèrent une ligne par taille/couleur (voir quotes.service.ts), toutes
    // créées à 0,00 €. Un groupe de 20 pièces réparti en 4 lignes n'était donc
    // facturé que sur 5 pièces — 75 % du montant perdu, sur une facture que le
    // client paie légitimement.
    //
    // Un prix uniforme reste correct même quand certaines pièces coûtent plus
    // cher (flocage) : le dashboard envoie alors le prix unitaire MOYEN
    // (base × qté + flocage × nb floqué) ÷ qté. Seule la ventilation par ligne
    // est lissée.
    //
    // MAIS un prix moyen ne tombe pas toujours juste au centime. Appliquer
    // `unitPrice.toFixed(2)` à chaque ligne faisait dériver le TOTAL : un
    // groupe de 3 pièces à 35 € était facturé 35,01 €, un lot de 13 à 1000 €
    // tombait à 999,96 €. L'écart s'affichait à l'opérateur, mais le client
    // payait quand même le montant dérivé.
    //
    // On raisonne donc en CENTIMES ENTIERS : le total voulu est réparti sur
    // les lignes, et le reste de la division est distribué une unité à la fois
    // sur les premières pièces. La somme facturée retombe exactement sur le
    // total annoncé, et l'écart maximal entre deux pièces est d'un centime.
    //
    // `variant_id` est préservé quand il existe : le forcer en ligne `custom`
    // romprait le lien produit et le stock ne serait plus décrémenté.
    //
    // `applied_discount` est conservé partout : l'omettre effaçait une remise
    // négociée au moment même de l'envoi de la facture, et le client recevait
    // un montant supérieur à celui convenu.
    //
    // `taxable` / `requires_shipping` ne sont renvoyés que sur les lignes
    // `custom` : sur une ligne à variant, Shopify les dérive du produit et peut
    // refuser qu'on les impose — le rejet casserait l'envoi de la facture pour
    // un gain nul.
    const keep = (li: Record<string, any>) => ({
      quantity: li.quantity as number,
      properties: li.properties as Array<{ name: string; value: string }>,
      ...(li.applied_discount ? { applied_discount: li.applied_discount } : {}),
    });

    // Répartition du total en centimes entiers (cf. commentaire ci-dessus).
    //
    // CONTRAINTE : Shopify n'accepte qu'UN prix unitaire par ligne, et facture
    // prix × quantité. Le montant d'une ligne est donc forcément un multiple
    // de sa quantité — on ne peut pas ajouter un centime à une seule pièce
    // d'une ligne qui en compte trois.
    //
    // La répartition se fait donc à l'échelle de la LIGNE : chaque ligne reçoit
    // un prix unitaire au centime, et le résiduel est absorbé en ajoutant un
    // centime au prix unitaire des premières lignes — celles dont la quantité
    // permet d'écouler le reste sans le dépasser.
    //
    // LIMITE ASSUMÉE : sur une ligne UNIQUE dont le total ne se divise pas au
    // centime (ex. 1000 € pour 13 pièces = 76,923… € l'unité), aucun prix
    // unitaire ne retombe sur le total — la contrainte vient de Shopify, pas
    // du calcul. L'écart reste alors de quelques centimes et le dashboard
    // l'affiche à l'opérateur avant l'envoi.
    //
    // Dès que le devis compte plusieurs lignes — le cas des commandes de
    // groupe, réparties par taille/couleur — la répartition retombe juste.
    const qty = (li: Record<string, any>) => Math.max(1, Number(li.quantity) || 1);
    const totalPieces = items.reduce((n, li) => n + qty(li), 0);
    const totalCents = Math.round(unitPrice * totalPieces * 100);

    // Prix unitaire plancher, puis centimes à replacer.
    const baseCents = Math.floor(totalCents / totalPieces);
    let reste = totalCents - baseCents * totalPieces;

    const priceFor = (li: Record<string, any>): string => {
      const n = qty(li);
      // +1 centime sur le prix unitaire coûte `n` centimes sur la ligne.
      //
      // On l'accorde dès que le reste couvre au moins la MOITIÉ de la ligne :
      // exiger le reste entier arrondissait toujours vers le bas et pouvait
      // faire pire que l'ancien calcul (une ligne unique de 7 pièces perdait
      // 5 centimes). Ce seuil revient à arrondir au plus proche.
      const bonus = reste * 2 >= n ? 1 : 0;
      reste -= bonus * n;
      return ((baseCents + bonus) / 100).toFixed(2);
    };

    const rebuilt: ShopifyLineItem[] = items.map((li) =>
      li.variant_id
        ? {
            variant_id: li.variant_id as number | string,
            price: priceFor(li),
            ...keep(li),
          }
        : {
            title: li.title as string,
            price: priceFor(li),
            custom: true,
            ...keep(li),
            ...(li.taxable !== undefined ? { taxable: li.taxable } : {}),
            ...(li.requires_shipping !== undefined
              ? { requires_shipping: li.requires_shipping }
              : {}),
          },
    );

    return this.updateDraftOrderLineItems(draftOrderId, rebuilt);
  }

  /**
   * Retire une ligne d'un draft order.
   * Shopify ne supprime pas une ligne individuellement : on recupere le draft,
   * on filtre la ligne visee, puis on remet a jour la liste des line_items.
   */
  async deleteDraftOrderLine(
    draftOrderId: string | number,
    lineId: string | number,
  ): Promise<Record<string, any>> {
    const draft = await this.getDraftOrder(draftOrderId);
    const remaining = (draft.line_items || []).filter(
      (li: Record<string, any>) => String(li.id) !== String(lineId),
    );

    // On reconstruit les line_items compatibles avec l'API de mise a jour.
    //
    // `applied_discount` est conservé : sans lui, retirer UN article du panier
    // faisait disparaître la remise accordée sur les autres — le client voyait
    // son total augmenter en supprimant un produit. `price` est conservé sur
    // les lignes à variant, sinon Shopify les re-tarifait au prix courant.
    //
    // `taxable` / `requires_shipping` : lignes `custom` uniquement (cf.
    // setDraftOrderPrice) — Shopify les dérive du variant et peut refuser
    // qu'on les impose.
    const rebuilt: ShopifyLineItem[] = remaining.map(
      (li: Record<string, any>) => {
        const common = {
          quantity: li.quantity,
          properties: li.properties,
          ...(li.applied_discount
            ? { applied_discount: li.applied_discount }
            : {}),
        };
        if (li.variant_id) {
          return { variant_id: li.variant_id, price: li.price, ...common };
        }
        return {
          title: li.title,
          price: li.price,
          custom: true,
          ...common,
          ...(li.taxable !== undefined ? { taxable: li.taxable } : {}),
          ...(li.requires_shipping !== undefined
            ? { requires_shipping: li.requires_shipping }
            : {}),
        };
      },
    );

    return this.updateDraftOrderLineItems(draftOrderId, rebuilt);
  }

  /**
   * Recupere un produit et ses variants (id + titre + prix).
   * Sert a retrouver le variant_id a partir d'un product_id (pour le panier natif).
   */
  async getProductVariants(
    productId: string | number,
  ): Promise<{
    productId: string | number;
    title: string;
    variants: Array<{ id: number; title: string; price: string; sku?: string }>;
  }> {
    const response = await this.fetchShopify(
      `${this.getBaseUrl()}/products/${productId}.json`,
      { method: 'GET', headers: await this.getHeaders() },
    );

    if (!response.ok) {
      throw new Error(
        `Erreur Shopify (${response.status}): ${response.statusText}`,
      );
    }

    const result = (await response.json()) as {
      product: {
        title: string;
        variants: Array<{
          id: number;
          title: string;
          price: string;
          sku?: string;
        }>;
      };
    };

    return {
      productId,
      title: result.product.title,
      variants: (result.product.variants || []).map((v) => ({
        id: v.id,
        title: v.title,
        price: v.price,
        sku: v.sku,
      })),
    };
  }

  /**
   * Verifie la connexion a la boutique Shopify.
   */
  async verifyConnection(): Promise<{
    success: boolean;
    shop?: string;
    message: string;
  }> {
    try {
      const response = await this.fetchShopify(`${this.getBaseUrl()}/shop.json`, {
        method: 'GET',
        headers: await this.getHeaders(),
      });

      if (!response.ok) {
        return { success: false, message: 'Connexion Shopify echouee' };
      }

      const result = (await response.json()) as { shop: { name: string } };
      return {
        success: true,
        shop: result.shop.name,
        message: 'Connexion Shopify valide',
      };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  // ───────────────────────────── Customers ─────────────────────────────
  // Rattachement des comptes admin aux clients Shopify.
  //
  // IMPORTANT : les endpoints REST /customers.json et /customers/search.json
  // ont été SUPPRIMÉS par Shopify à partir de l'API 2025-04. Sur les versions
  // récentes (2026-01…), les clients ne sont accessibles qu'en GraphQL : c'est
  // donc ce qu'on utilise ici.
  //
  // Scopes requis sur l'app privée : read_customers, write_customers.

  /** Endpoint GraphQL Admin (même version que l'API REST configurée). */
  private getGraphqlUrl(): string {
    return `${this.getBaseUrl()}/graphql.json`;
  }

  /**
   * Exécute une requête GraphQL Admin.
   * Renvoie { data } ou { error } (erreurs réseau, HTTP, ou GraphQL).
   */
  private async graphql(
    query: string,
    variables: Record<string, any> = {},
  ): Promise<{ data?: any; error?: string }> {
    try {
      const response = await this.fetchShopify(this.getGraphqlUrl(), {
        method: 'POST',
        headers: await this.getHeaders(),
        body: JSON.stringify({ query, variables }),
      });

      const text = await response.text().catch(() => '');
      if (!response.ok) {
        this.logger.error(`GraphQL Shopify : ${response.status} ${text}`);
        // 401/403 = token ou scopes ; on le dit clairement plutôt qu'un code brut.
        if (response.status === 401 || response.status === 403) {
          return {
            error:
              'accès refusé — vérifiez le token et les scopes read_customers / write_customers',
          };
        }
        return { error: `Shopify (${response.status})` };
      }

      const json = JSON.parse(text) as {
        data?: any;
        errors?: { message: string }[];
      };
      if (json.errors?.length) {
        const msg = json.errors.map((e) => e.message).join(' | ');
        this.logger.error(`GraphQL Shopify : ${msg}`);
        return { error: msg };
      }
      return { data: json.data };
    } catch (e) {
      this.logger.error(`GraphQL Shopify : ${(e as Error).message}`);
      return { error: (e as Error).message };
    }
  }

  /** Cherche un customer par e-mail. Renvoie null si aucun (ou en cas d'erreur). */
  async findCustomerByEmail(
    email: string,
  ): Promise<Record<string, any> | null> {
    const mail = String(email || '').trim().toLowerCase();
    if (!mail) return null;

    const query = `
      query FindCustomer($q: String!) {
        customers(first: 1, query: $q) {
          edges { node { id email firstName lastName } }
        }
      }`;
    // Le filtre `email:"..."` cible l'adresse exacte.
    const res = await this.graphql(query, { q: `email:"${mail}"` });
    if (res.error || !res.data) return null;

    const edges = res.data.customers?.edges || [];
    const node = edges[0]?.node;
    if (!node) return null;
    // Sécurité : Shopify peut renvoyer un résultat approchant.
    if (String(node.email || '').toLowerCase() !== mail) return null;
    return node;
  }

  /**
   * Crée un customer Shopify, ou renvoie celui qui existe déjà pour cet e-mail.
   *
   * Utilisé à l'invitation d'un admin : le compte apparaît aussi dans les
   * clients de la boutique. `note`/`tags` permettent de repérer ces comptes.
   *
   * L'id renvoyé est l'id NUMÉRIQUE (extrait du GID GraphQL), pour rester
   * compatible avec le reste du code qui manipule des ids REST.
   */
  async createCustomer(input: {
    email: string;
    firstName?: string;
    lastName?: string;
    tags?: string;
    note?: string;
  }): Promise<{
    ok: boolean;
    customer?: Record<string, any>;
    existed?: boolean;
    error?: string;
  }> {
    const mail = String(input.email || '').trim().toLowerCase();
    if (!mail) return { ok: false, error: 'E-mail manquant.' };

    // Déjà client ? on le réutilise (Shopify refuse les doublons d'e-mail).
    const existing = await this.findCustomerByEmail(mail);
    if (existing) {
      return {
        ok: true,
        existed: true,
        customer: { ...existing, id: this.gidToId(existing.id) },
      };
    }

    const mutation = `
      mutation CreateCustomer($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer { id email firstName lastName }
          userErrors { field message }
        }
      }`;

    const variables = {
      input: {
        email: mail,
        firstName: input.firstName || undefined,
        lastName: input.lastName || undefined,
        // GraphQL attend une liste de tags (le REST prenait une chaîne).
        tags: input.tags
          ? input.tags.split(',').map((t) => t.trim()).filter(Boolean)
          : undefined,
        note: input.note || undefined,
      },
    };

    const res = await this.graphql(mutation, variables);
    if (res.error) return { ok: false, error: res.error };

    const payload = res.data?.customerCreate;
    const userErrors = payload?.userErrors || [];
    if (userErrors.length) {
      const msg = userErrors
        .map((e: any) => `${(e.field || []).join('.')} ${e.message}`.trim())
        .join(' | ');
      this.logger.error(`Echec creation customer ${mail} : ${msg}`);
      return { ok: false, error: msg };
    }

    const customer = payload?.customer;
    if (!customer) return { ok: false, error: 'Réponse Shopify inattendue.' };

    return {
      ok: true,
      existed: false,
      customer: { ...customer, id: this.gidToId(customer.id) },
    };
  }

  /** `gid://shopify/Customer/123` -> `123`. */
  private gidToId(gid: string | number | undefined): string {
    const s = String(gid || '');
    const m = s.match(/\/(\d+)(?:\?.*)?$/);
    return m ? m[1] : s;
  }

  // ───────────────────────── Prix des variants ─────────────────────────
  // Utilisés quand l'admin change un prix : le variant Shopify doit suivre,
  // sinon le client paierait l'ancien prix au checkout.
  // Scopes requis : read_products, write_products.

  /**
   * Met le prix de TOUS les variants d'un produit à la même valeur.
   *
   * Les textiles ont un variant par couleur (15) : changer le prix du produit
   * doit donc tous les couvrir. `productVariantsBulkUpdate` (GraphQL, obligatoire
   * depuis 2025-04) accepte jusqu'à 250 variants par appel — largement suffisant.
   *
   * @param productId  id numérique du produit (ex. 9167767240867)
   * @param price      nouveau prix (ex. 2.45)
   */
  async updateProductPrice(
    productId: string | number,
    price: number,
  ): Promise<{ ok: boolean; updated?: number; error?: string }> {
    const gid = `gid://shopify/Product/${this.gidToId(productId)}`;

    // 1) Tous les variants du produit.
    const lookup = await this.graphql(
      `query ProductVariants($id: ID!) {
         product(id: $id) {
           id
           title
           variants(first: 250) { edges { node { id } } }
         }
       }`,
      { id: gid },
    );
    if (lookup.error) return { ok: false, error: lookup.error };

    const product = lookup.data?.product;
    if (!product) return { ok: false, error: `Produit ${productId} introuvable.` };

    const ids: string[] = (product.variants?.edges || []).map(
      (e: any) => e.node.id,
    );
    if (!ids.length) {
      return { ok: false, error: `Aucun variant pour « ${product.title} ».` };
    }

    // 2) Même prix pour tous les variants.
    const res = await this.graphql(
      `mutation SetPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
         productVariantsBulkUpdate(productId: $productId, variants: $variants) {
           productVariants { id price }
           userErrors { field message }
         }
       }`,
      {
        productId: gid,
        variants: ids.map((id) => ({ id, price: price.toFixed(2) })),
      },
    );
    if (res.error) return { ok: false, error: res.error };

    const errs = res.data?.productVariantsBulkUpdate?.userErrors || [];
    if (errs.length) {
      const msg = errs
        .map((e: any) => `${(e.field || []).join('.')} ${e.message}`.trim())
        .join(' | ');
      this.logger.error(`Echec prix produit ${productId} : ${msg}`);
      return { ok: false, error: msg };
    }

    const updated =
      res.data?.productVariantsBulkUpdate?.productVariants?.length || 0;
    return { ok: true, updated };
  }

}
