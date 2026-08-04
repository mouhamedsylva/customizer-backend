import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Ligne d'article pour un draft order Shopify.
 * `custom: true` permet de creer une ligne sans variant existant (produit personnalise).
 */
export interface ShopifyLineItem {
  title?: string;
  variant_id?: number | string;
  price?: string;
  quantity: number;
  custom?: boolean;
  properties?: Array<{ name: string; value: string }>;
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

  /** Headers authentifies pour Shopify. */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token':
        this.config.get<string>('SHOPIFY_ACCESS_TOKEN') || '',
    };
  }

  /** Délai au-delà duquel un appel Shopify est abandonné. */
  private static readonly TIMEOUT_MS = 20000;

  /**
   * `fetch` borné dans le temps.
   *
   * Le `fetch` natif de Node n'a AUCUN timeout par défaut : un appel qui pend
   * bloque son appelant indéfiniment. Côté synchro périodique, cela gèle le
   * verrou anti-chevauchement et fige toutes les passes suivantes.
   */
  private async fetchShopify(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    try {
      return await fetch(url, {
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
      headers: this.getHeaders(),
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
      { method: 'GET', headers: this.getHeaders() },
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
        headers: this.getHeaders(),
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
      { method: 'GET', headers: this.getHeaders() },
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
        headers: this.getHeaders(),
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
      { method: 'GET', headers: this.getHeaders() },
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
          headers: this.getHeaders(),
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
        headers: this.getHeaders(),
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
        headers: this.getHeaders(),
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
    // `variant_id` est préservé quand il existe : le forcer en ligne `custom`
    // romprait le lien produit et le stock ne serait plus décrémenté.
    const rebuilt: ShopifyLineItem[] = items.map((li) =>
      li.variant_id
        ? {
            variant_id: li.variant_id as number | string,
            price: unitPrice.toFixed(2),
            quantity: li.quantity as number,
            properties: li.properties as Array<{ name: string; value: string }>,
          }
        : {
            title: li.title as string,
            price: unitPrice.toFixed(2),
            quantity: li.quantity as number,
            custom: true,
            properties: li.properties as Array<{ name: string; value: string }>,
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
    const rebuilt: ShopifyLineItem[] = remaining.map(
      (li: Record<string, any>) => {
        if (li.variant_id) {
          return {
            variant_id: li.variant_id,
            quantity: li.quantity,
            properties: li.properties,
          };
        }
        return {
          title: li.title,
          price: li.price,
          quantity: li.quantity,
          custom: true,
          properties: li.properties,
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
      { method: 'GET', headers: this.getHeaders() },
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
        headers: this.getHeaders(),
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
        headers: this.getHeaders(),
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
