import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { Order } from '../database/entities/order.entity';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
  ) {}

  /**
   * Vérifie la signature HMAC d'un webhook Shopify.
   * @param rawBody corps BRUT de la requête (Buffer), tel que reçu.
   * @param hmacHeader valeur de l'en-tête X-Shopify-Hmac-Sha256.
   * Retourne true si la signature est valide (ou si aucun secret n'est
   * configuré — mode tolérant pour ne pas bloquer en dev).
   */
  verifyHmac(rawBody: Buffer, hmacHeader?: string): boolean {
    const secret = this.config.get<string>('SHOPIFY_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.warn(
        'SHOPIFY_WEBHOOK_SECRET absent : signature webhook NON vérifiée.',
      );
      return true; // tolérant tant que le secret n'est pas configuré
    }
    if (!hmacHeader || !rawBody) return false;

    const digest = createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    try {
      const a = Buffer.from(digest);
      const b = Buffer.from(hmacHeader);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /**
   * Enregistre (ou met à jour) une commande Shopify reçue par webhook.
   * Extrait les infos utiles pour la production.
   */
  async saveOrder(payload: Record<string, any>): Promise<void> {
    const shopifyOrderId = String(payload.id);

    const customer = payload.customer || {};
    const customerName =
      [customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
      payload.email ||
      null;

    // Ne garde que les infos utiles de chaque ligne (dont les propriétés
    // = couleur, taille, URLs aperçus/assets Cloudinary).
    const lineItems = Array.isArray(payload.line_items)
      ? payload.line_items.map((li: Record<string, any>) => ({
          title: li.title,
          variantTitle: li.variant_title,
          quantity: li.quantity,
          price: li.price,
          sku: li.sku,
          properties: li.properties, // [{name, value}, …]
        }))
      : [];

    const entity = this.orders.create({
      shopifyOrderId,
      orderNumber: payload.name || (payload.order_number ? `#${payload.order_number}` : null),
      customerEmail: payload.email || customer.email || null,
      customerName,
      totalPrice: payload.total_price ?? null,
      currency: payload.currency ?? null,
      lineItems,
      financialStatus: payload.financial_status ?? null,
      shopifyCreatedAt: payload.created_at ? new Date(payload.created_at) : null,
    });

    // save() fait un upsert sur la clé primaire (shopifyOrderId) : rejouer un
    // webhook ne crée pas de doublon.
    await this.orders.save(entity);
    this.logger.log(
      `Commande ${entity.orderNumber || shopifyOrderId} enregistrée (${lineItems.length} article(s)).`,
    );
  }

  /** Liste des commandes en base (pour le dashboard admin — étape 3). */
  async findAll(): Promise<Order[]> {
    return this.orders.find({ order: { receivedAt: 'DESC' } });
  }
}
