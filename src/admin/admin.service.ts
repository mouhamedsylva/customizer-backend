import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Order } from '../database/entities/order.entity';
import { Quote } from '../database/entities/quote.entity';
import { Design } from '../database/entities/design.entity';

/** Critères de filtrage / tri des commandes. */
export interface OrderQuery {
  period?: string;      // all | 7d | 30d | month | quarter | year
  payment?: string;     // all | paid | pending | refunded…
  production?: string;  // all | to_produce | producing | ready | shipped
  sort?: string;        // date_desc | date_asc | amount_desc | amount_asc
  limit?: number;
}

/** Date de début d'une période (null = pas de filtre). */
export function periodStart(period?: string): Date | null {
  const now = new Date();
  switch (period) {
    case '7d':
      return new Date(now.getTime() - 7 * 86400000);
    case '30d':
      return new Date(now.getTime() - 30 * 86400000);
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3) * 3;
      return new Date(now.getFullYear(), q, 1);
    }
    case 'year':
      return new Date(now.getFullYear(), 0, 1);
    default:
      return null; // 'all' ou non précisé
  }
}

/**
 * Accès aux données pour le dashboard admin.
 *
 * Note MySQL : trier (ORDER BY) des lignes qui contiennent de grosses colonnes
 * JSON peut déclencher « Out of sort memory ». Pour l'éviter, on récupère
 * d'abord les IDs triés (colonnes légères indexées), puis on charge les lignes
 * complètes et on les ré-ordonne côté application.
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Quote) private readonly quotes: Repository<Quote>,
    @InjectRepository(Design) private readonly designs: Repository<Design>,
  ) {}

  /**
   * Commandes, avec filtres et tri.
   * @param period  'all' | '7d' | '30d' | 'month' | 'quarter' | 'year'
   * @param sort    'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'
   */
  async getOrders(opts: OrderQuery = {}): Promise<Order[]> {
    const qb = this.orders
      .createQueryBuilder('o')
      .select('o.shopifyOrderId', 'id');

    // Filtre par période (sur la date réelle de commande).
    const since = periodStart(opts.period);
    if (since) qb.andWhere('o.shopifyCreatedAt >= :since', { since });

    // Filtre par statut de paiement.
    if (opts.payment && opts.payment !== 'all') {
      qb.andWhere('o.financialStatus = :fin', { fin: opts.payment });
    }
    // Filtre par étape de production.
    if (opts.production && opts.production !== 'all') {
      qb.andWhere('o.productionStatus = :prod', { prod: opts.production });
    }

    // Tri (sur des colonnes légères : évite « Out of sort memory »).
    // COALESCE : une commande sans date Shopify se rabat sur sa date de
    // réception, sinon MySQL la reléguerait tout en bas (NULL) alors qu'elle
    // peut être la plus récente.
    const dateExpr = 'COALESCE(o.shopifyCreatedAt, o.receivedAt)';
    switch (opts.sort) {
      case 'date_asc':
        qb.orderBy(dateExpr, 'ASC');
        break;
      case 'amount_desc':
        qb.orderBy('CAST(o.totalPrice AS DECIMAL(10,2))', 'DESC');
        break;
      case 'amount_asc':
        qb.orderBy('CAST(o.totalPrice AS DECIMAL(10,2))', 'ASC');
        break;
      default:
        qb.orderBy(dateExpr, 'DESC');
    }
    // Départage stable : à date (ou montant) égale, la plus récemment reçue
    // d'abord, puis le plus grand ID Shopify (les IDs sont croissants).
    qb.addOrderBy('o.receivedAt', 'DESC')
      .addOrderBy('o.shopifyOrderId', 'DESC')
      .limit(opts.limit ?? 300);

    const ids = await qb.getRawMany<{ id: string }>();
    if (!ids.length) return [];

    const rows = await this.orders.find({
      where: { shopifyOrderId: In(ids.map((r) => r.id)) },
    });
    return this.reorder(rows, ids.map((r) => String(r.id)), (o) =>
      String(o.shopifyOrderId),
    );
  }

  /** Marque des commandes comme vues (retire le marqueur « nouveau »). */
  async markOrdersSeen(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.orders.update({ shopifyOrderId: In(ids) }, { seen: true });
  }

  /** Marque des devis comme vus. */
  async markQuotesSeen(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.quotes.update({ id: In(ids) }, { seen: true });
  }

  /** Devis, avec filtre de période optionnel (pour l'export). */
  async getQuotes(period?: string): Promise<Quote[]> {
    const qb = this.quotes.createQueryBuilder('q').select('q.id', 'id');
    const since = periodStart(period);
    if (since) qb.andWhere('q.createdAt >= :since', { since });

    const ids = await qb
      .orderBy('q.createdAt', 'DESC')
      .limit(500)
      .getRawMany<{ id: string }>();
    if (!ids.length) return [];
    const rows = await this.quotes.find({
      where: { id: In(ids.map((r) => r.id)) },
    });
    return this.reorder(rows, ids.map((r) => r.id), (q) => q.id);
  }

  /** Un devis par son id (pour l'envoi de facture). */
  async getQuote(id: string): Promise<Quote | null> {
    return this.quotes.findOne({ where: { id } });
  }

  /** Met à jour le statut / montant / suivi de relance d'un devis. */
  async updateQuoteStatus(
    id: string,
    patch: Partial<
      Pick<
        Quote,
        | 'draftStatus'
        | 'totalPrice'
        | 'paidOrderId'
        | 'invoiceSentAt'
        | 'remindersSent'
        | 'lastReminderAt'
      >
    >,
  ): Promise<void> {
    await this.quotes.update(id, patch);
  }

  /** Une commande par son id Shopify. */
  async getOrder(shopifyOrderId: string): Promise<Order | null> {
    return this.orders.findOne({ where: { shopifyOrderId } });
  }

  /** Change le statut de production d'une commande. */
  async setProductionStatus(
    shopifyOrderId: string,
    status: string,
  ): Promise<void> {
    await this.orders.update(shopifyOrderId, {
      productionStatus: status,
      productionUpdatedAt: new Date(),
    });
  }

  /** Enregistre le résultat d'une expédition Shopify. */
  async setFulfillment(
    shopifyOrderId: string,
    patch: { fulfillmentStatus: string | null; trackingNumber: string | null },
  ): Promise<void> {
    await this.orders.update(shopifyOrderId, patch);
  }

  /** Enregistre la note interne d'une commande. */
  async setInternalNote(
    shopifyOrderId: string,
    note: string,
  ): Promise<void> {
    await this.orders.update(shopifyOrderId, { internalNote: note || null });
  }

  async getDesigns(): Promise<Design[]> {
    const ids = await this.designs
      .createQueryBuilder('d')
      .select('d.id', 'id')
      .orderBy('d.createdAt', 'DESC')
      .limit(300)
      .getRawMany<{ id: string }>();
    if (!ids.length) return [];
    const rows = await this.designs.find({
      where: { id: In(ids.map((r) => r.id)) },
    });
    return this.reorder(rows, ids.map((r) => r.id), (d) => d.id);
  }

  /** Ré-ordonne des lignes selon l'ordre d'une liste d'IDs. */
  private reorder<T>(rows: T[], order: string[], key: (r: T) => string): T[] {
    const map = new Map(rows.map((r) => [key(r), r]));
    return order.map((id) => map.get(id)).filter((r): r is T => !!r);
  }
}
