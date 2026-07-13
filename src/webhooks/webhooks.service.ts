import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { Order } from '../database/entities/order.entity';
import { ShopifyService } from '../shared/shopify.service';

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private syncTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly shopify: ShopifyService,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
  ) {}

  /**
   * Au démarrage : synchronise l'historique des commandes Shopify, puis
   * relance une synchro périodique (filet de sécurité si un webhook échoue).
   * Tout est AUTOMATIQUE : aucune action manuelle requise.
   */
  onModuleInit(): void {
    // Première synchro peu après le démarrage (laisse la BDD s'initialiser).
    setTimeout(() => {
      void this.importFromShopify('démarrage');
    }, 8000);

    // Synchro périodique toutes les 10 minutes.
    const INTERVAL_MS = 10 * 60 * 1000;
    this.syncTimer = setInterval(() => {
      void this.importFromShopify('périodique');
    }, INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
  }

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
    const customerPhone =
      payload.phone || customer.phone ||
      payload.shipping_address?.phone ||
      payload.billing_address?.phone || null;

    // Toutes les infos client utiles à la production/expédition.
    const fmtAddr = (a: Record<string, any> | undefined | null) =>
      a
        ? {
            name: a.name,
            company: a.company,
            address1: a.address1,
            address2: a.address2,
            zip: a.zip,
            city: a.city,
            province: a.province,
            country: a.country,
            phone: a.phone,
          }
        : null;
    const customerInfo: Record<string, unknown> = {
      email: payload.email || customer.email || null,
      phone: customerPhone,
      note: payload.note || null,
      shipping: fmtAddr(payload.shipping_address),
      billing: fmtAddr(payload.billing_address),
    };

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
      customerPhone,
      customerInfo,
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


  /**
   * Synchronise les commandes Shopify vers la base (rattrape l'historique et
   * toute commande manquée par un webhook). Robuste : n'interrompt jamais le
   * backend même si l'API Shopify échoue (ex. scope read_orders manquant).
   */
  async importFromShopify(reason = 'manuel'): Promise<{ imported: number }> {
    let orders: Record<string, any>[] = [];
    try {
      orders = await this.shopify.listOrders(250);
    } catch (e) {
      this.logger.warn(
        `Synchro Shopify (${reason}) impossible : ${(e as Error).message}. ` +
          `Le token a-t-il le scope read_orders ?`,
      );
      return { imported: 0 };
    }

    let imported = 0;
    for (const o of orders) {
      try {
        await this.saveOrder(o);
        imported++;
      } catch (e) {
        this.logger.warn(
          `Import commande ${o?.id} échoué: ${(e as Error).message}`,
        );
      }
    }
    this.logger.log(
      `Synchro Shopify (${reason}) : ${imported}/${orders.length} commande(s).`,
    );
    return { imported };
  }
}
