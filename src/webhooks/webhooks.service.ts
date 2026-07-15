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
import { EmailService } from '../shared/email.service';
import { SettingsService } from '../admin/settings.service';
import {
  fromShopify,
  ProductionStatus,
  ShippingState,
} from '../shared/shipping-status';

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private syncTimer?: NodeJS.Timeout;
  /** Vrai jusqu'à la première synchro : celle-ci rattrape l'historique en silence. */
  private firstSync = true;

  constructor(
    private readonly config: ConfigService,
    private readonly shopify: ShopifyService,
    private readonly email: EmailService,
    private readonly settings: SettingsService,
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
   *
   * @param notify  envoyer l'alerte e-mail à l'équipe si la commande est
   *   inconnue. Faux pendant les synchros de rattrapage : sans cela, le premier
   *   import enverrait un e-mail par commande de l'historique.
   */
  async saveOrder(
    payload: Record<string, any>,
    notify = true,
  ): Promise<void> {
    const shopifyOrderId = String(payload.id);
    const isNew = !(await this.orders.exists({ where: { shopifyOrderId } }));

    const customer = payload.customer || {};
    const ship = payload.shipping_address || {};
    const bill = payload.billing_address || {};
    // Nom : compte client, sinon nom porté par l'adresse (cas commande invité,
    // où l'objet customer est absent mais l'adresse contient bien un nom).
    const customerName =
      [customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
      ship.name ||
      [ship.first_name, ship.last_name].filter(Boolean).join(' ') ||
      bill.name ||
      [bill.first_name, bill.last_name].filter(Boolean).join(' ') ||
      payload.email ||
      customer.email ||
      null;
    const customerPhone =
      payload.phone || customer.phone ||
      ship.phone || bill.phone || null;

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
      // Statut d'exécution : Shopify est la source de vérité. null = non traitée.
      fulfillmentStatus: payload.fulfillment_status ?? null,
      shopifyCreatedAt: payload.created_at ? new Date(payload.created_at) : null,
    });

    // Le marqueur « nouveau » et le n° de suivi appartiennent à l'atelier :
    // une re-synchro Shopify ne doit pas les réinitialiser.
    // (fulfillmentStatus, lui, VIENT de Shopify : on le garde.)
    if (!isNew) {
      delete (entity as Partial<Order>).seen;
      delete (entity as Partial<Order>).trackingNumber;

      // PROTECTION DES INFOS CLIENT.
      // Le webhook orders/create fournit le client complet (nom, e-mail,
      // adresse). Mais la synchro périodique (/orders.json) renvoie souvent ces
      // champs VIDES selon la protection des données du compte. Sans garde, elle
      // écrasait le nom/e-mail par null → les infos « clignotaient » puis
      // disparaissaient dans le dashboard et la fiche. On ne remplace donc un
      // champ client QUE si la nouvelle valeur est réellement renseignée.
      const existing = await this.orders.findOne({
        where: { shopifyOrderId },
      });
      if (existing) {
        if (!entity.customerName) entity.customerName = existing.customerName;
        if (!entity.customerEmail) entity.customerEmail = existing.customerEmail;
        if (!entity.customerPhone) entity.customerPhone = existing.customerPhone;
        // customerInfo : on ne remplace que si le nouveau apporte au moins une
        // info (adresse OU e-mail OU téléphone), sinon on garde l'ancien.
        const ni = customerInfo;
        const hasNew =
          ni.email || ni.phone || ni.shipping || ni.billing || ni.note;
        if (!hasNew) {
          delete (entity as Partial<Order>).customerInfo;
        }
      }

      // Le suivi de production suit Shopify quand Shopify a bougé, mais sans
      // rétrograder une étape que Shopify ne sait pas exprimer (« Prête »).
      const current = (existing?.productionStatus ||
        'to_produce') as ProductionStatus;
      const next = fromShopify(this.shippingStateOf(payload), current);

      if (next) {
        entity.productionStatus = next;
        entity.productionUpdatedAt = new Date();
        this.logger.log(
          `Commande ${shopifyOrderId} : suivi aligné sur Shopify (${current} -> ${next}).`,
        );
      } else {
        delete (entity as Partial<Order>).productionStatus;
      }
    }

    // save() fait un upsert sur la clé primaire (shopifyOrderId) : rejouer un
    // webhook ne crée pas de doublon.
    await this.orders.save(entity);
    this.logger.log(
      `Commande ${entity.orderNumber || shopifyOrderId} enregistrée (${lineItems.length} article(s)).`,
    );

    if (isNew && notify) {
      void this.notifyNewOrder(entity, lineItems.length);
    }
  }

  /**
   * État d'exécution d'une commande, déduit de son payload Shopify.
   *
   * `fulfillment_status` ne connaît que null | partial | fulfilled : il ignore
   * « en préparation ». Ce statut vit sur les fulfillment orders, que le
   * payload n'inclut pas toujours — on se rabat alors sur les `fulfillments`
   * déjà créés, ce qui évite un appel API par commande à chaque synchro.
   */
  private shippingStateOf(payload: Record<string, any>): ShippingState {
    const fs = String(payload.fulfillment_status || '').toLowerCase();
    if (fs === 'fulfilled') return 'fulfilled';
    if (fs === 'partial') return 'partial';

    // Un fulfillment ouvert (non « success ») = préparation en cours.
    const fulfillments = Array.isArray(payload.fulfillments)
      ? payload.fulfillments
      : [];
    const inProgress = fulfillments.some(
      (f: Record<string, any>) =>
        f && String(f.status || '').toLowerCase() === 'pending',
    );
    if (inProgress) return 'in_progress';

    return 'unfulfilled';
  }

  /** Alerte l'équipe qu'une commande vient d'arriver (si activé au dashboard). */
  private async notifyNewOrder(order: Order, itemCount: number): Promise<void> {
    try {
      const cfg = await this.settings.get();
      if (!cfg.notifyEmailEnabled || !cfg.notifyEmail) return;

      const backendUrl =
        this.config.get<string>('BACKEND_URL') ||
        this.config.get<string>('PUBLIC_URL') ||
        '';
      await this.email.sendInternalAlert(
        cfg.notifyEmail,
        `Nouvelle commande ${order.orderNumber || ''}`.trim(),
        [
          `<strong>Client :</strong> ${order.customerName || '—'}`,
          `<strong>E-mail :</strong> ${order.customerEmail || '—'}`,
          `<strong>Total :</strong> ${order.totalPrice || '—'} ${order.currency || ''}`,
          `<strong>Articles :</strong> ${itemCount}`,
        ],
        backendUrl ? `${backendUrl}/api/admin` : undefined,
      );
    } catch (e) {
      this.logger.warn(`Alerte commande non envoyée : ${(e as Error).message}`);
    }
  }

  /** Liste des commandes en base (pour le dashboard admin — étape 3). */
  async findAll(): Promise<Order[]> {
    return this.orders.find({ order: { receivedAt: 'DESC' } });
  }


  /**
   * Synchronise les commandes Shopify vers la base (rattrape l'historique et
   * toute commande manquée par un webhook). Robuste : n'interrompt jamais le
   * backend même si l'API Shopify échoue (ex. scope read_orders manquant).
   *
   * La synchro NOTIFIE les commandes réellement nouvelles : c'est le seul
   * chemin fiable quand le webhook n'est pas configuré. Seul le tout premier
   * passage se tait — sinon il enverrait un e-mail par commande de
   * l'historique.
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

    // Rattrapage initial : base vide, ou toute première synchro de ce process.
    const known = await this.orders.count();
    const backfill = this.firstSync || known === 0;
    this.firstSync = false;

    let imported = 0;
    for (const o of orders) {
      try {
        await this.saveOrder(o, !backfill);
        imported++;
      } catch (e) {
        this.logger.warn(
          `Import commande ${o?.id} échoué: ${(e as Error).message}`,
        );
      }
    }
    this.logger.log(
      `Synchro Shopify (${reason}) : ${imported}/${orders.length} commande(s)` +
        (backfill ? ' — rattrapage initial, aucune alerte envoyée.' : '.'),
    );

    await this.syncShippingStates(orders);
    return { imported };
  }

  /**
   * Aligne le suivi de production sur l'état d'exécution réel de Shopify.
   *
   * Pourquoi une passe à part : « En préparation » ne figure PAS dans le
   * payload d'une commande — il vit sur ses fulfillment orders, qu'il faut
   * demander une par une. Pour que ça reste tenable, on n'interroge que les
   * commandes encore ouvertes (ni expédiées, ni annulées) : en régime normal,
   * ça se compte sur les doigts d'une main.
   */
  private async syncShippingStates(
    orders: Record<string, any>[],
  ): Promise<void> {
    const open = orders.filter(
      (o) =>
        String(o.fulfillment_status || '').toLowerCase() !== 'fulfilled' &&
        !o.cancelled_at,
    );
    if (!open.length) return;

    let aligned = 0;
    for (const o of open.slice(0, 60)) {
      // borne de sécurité : 60 appels max par passage
      try {
        if (await this.alignOne(String(o.id))) aligned++;
      } catch (e) {
        // Scope manquant, ou API indisponible : on n'interrompt pas la synchro.
        this.logger.warn(
          `État d'expédition ${o?.id} illisible : ${(e as Error).message}`,
        );
        return; // inutile d'insister sur les suivantes si le scope manque
      }
    }
    if (aligned) {
      this.logger.log(`${aligned} commande(s) réalignée(s) sur Shopify.`);
    }
  }

  /**
   * Aligne UNE commande sur l'état d'exécution que Shopify lui connaît.
   * Utilisé par le webhook orders/updated (immédiat) et par la synchro
   * périodique (rattrapage). Retourne true si le suivi a changé.
   */
  async alignOne(shopifyOrderId: string): Promise<boolean> {
    const row = await this.orders.findOne({
      where: { shopifyOrderId },
      select: { shopifyOrderId: true, productionStatus: true },
    });
    if (!row) return false;

    const state = await this.shopify.getShippingState(shopifyOrderId);
    const current = (row.productionStatus || 'to_produce') as ProductionStatus;
    const next = fromShopify(state, current);
    if (!next) return false;

    await this.orders.update(shopifyOrderId, {
      productionStatus: next,
      productionUpdatedAt: new Date(),
      fulfillmentStatus: state === 'fulfilled' ? 'fulfilled' : null,
    });
    this.logger.log(
      `Commande ${shopifyOrderId} : suivi aligné sur Shopify (${current} -> ${next}).`,
    );
    return true;
  }
}
