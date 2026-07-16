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

  /**
   * Cree un draft order Shopify.
   * Retourne l'objet draft_order tel que renvoye par Shopify.
   */
  async createDraftOrder(
    payload: CreateDraftOrderPayload,
  ): Promise<Record<string, any>> {
    const body = { draft_order: payload };

    const response = await fetch(`${this.getBaseUrl()}/draft_orders.json`, {
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
    const response = await fetch(
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
    const response = await fetch(
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
    const response = await fetch(
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
   * Liste les VRAIES commandes (payées/passées) — pour l'import historique.
   * Nécessite le scope read_orders sur le token d'accès.
   * status=any inclut les commandes ouvertes, fermées et annulées.
   */
  async listOrders(limit = 250): Promise<Record<string, any>[]> {
    const response = await fetch(
      `${this.getBaseUrl()}/orders.json?status=any&limit=${limit}`,
      { method: 'GET', headers: this.getHeaders() },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Erreur Shopify (${response.status}) sur /orders : ${response.statusText}. ${text}`,
      );
    }

    const result = (await response.json()) as {
      orders: Record<string, any>[];
    };
    return result.orders || [];
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
    const response = await fetch(
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
      const response = await fetch(
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

      const response = await fetch(`${this.getBaseUrl()}/fulfillments.json`, {
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
    const response = await fetch(
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

    // Reconstruit les lignes : seule la 1re (la ligne du devis) change de prix.
    const rebuilt: ShopifyLineItem[] = items.map((li, i) => ({
      title: li.title,
      price: i === 0 ? unitPrice.toFixed(2) : String(li.price),
      quantity: li.quantity,
      custom: true,
      properties: li.properties,
    }));

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
    const response = await fetch(
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
      const response = await fetch(`${this.getBaseUrl()}/shop.json`, {
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
  // Utilisés pour rattacher les comptes admin aux clients Shopify.
  // Scopes requis sur l'app privée : read_customers, write_customers.

  /** Cherche un customer par e-mail. Renvoie null si aucun (ou en cas d'erreur). */
  async findCustomerByEmail(
    email: string,
  ): Promise<Record<string, any> | null> {
    const mail = String(email || '').trim().toLowerCase();
    if (!mail) return null;
    try {
      const url =
        `${this.getBaseUrl()}/customers/search.json` +
        `?query=${encodeURIComponent('email:' + mail)}&limit=1`;
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.logger.warn(
          `Recherche customer ${mail} : ${response.status} ${text}`,
        );
        return null;
      }
      const result = (await response.json()) as {
        customers: Record<string, any>[];
      };
      const found = (result.customers || []).find(
        (c) => String(c.email || '').toLowerCase() === mail,
      );
      return found || null;
    } catch (e) {
      this.logger.warn(`Recherche customer ${mail} : ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Crée un customer Shopify, ou renvoie celui qui existe déjà pour cet e-mail.
   *
   * Utilisé à l'invitation d'un admin : le compte apparaît aussi dans les
   * clients de la boutique. `note`/`tags` permettent de repérer ces comptes.
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
    if (existing) return { ok: true, customer: existing, existed: true };

    try {
      const response = await fetch(`${this.getBaseUrl()}/customers.json`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          customer: {
            email: mail,
            first_name: input.firstName || undefined,
            last_name: input.lastName || undefined,
            tags: input.tags || undefined,
            note: input.note || undefined,
            // Pas d'e-mail d'invitation Shopify : la transmission des accès se
            // fait via le panneau de partage du dashboard.
            send_email_invite: false,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.logger.error(
          `Echec creation customer ${mail}: ${response.status} ${text}`,
        );
        return { ok: false, error: `Shopify (${response.status})` };
      }

      const result = (await response.json()) as {
        customer: Record<string, any>;
      };
      return { ok: true, customer: result.customer, existed: false };
    } catch (e) {
      this.logger.error(
        `Echec creation customer ${mail}: ${(e as Error).message}`,
      );
      return { ok: false, error: (e as Error).message };
    }
  }

}
