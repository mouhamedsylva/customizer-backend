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
}
