import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Order } from '../database/entities/order.entity';
import { Quote } from '../database/entities/quote.entity';
import { Design } from '../database/entities/design.entity';

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

  async getOrders(): Promise<Order[]> {
    const ids = await this.orders
      .createQueryBuilder('o')
      .select('o.shopifyOrderId', 'id')
      .orderBy('o.receivedAt', 'DESC')
      .limit(300)
      .getRawMany<{ id: string }>();
    if (!ids.length) return [];
    const rows = await this.orders.find({
      where: { shopifyOrderId: In(ids.map((r) => r.id)) },
    });
    return this.reorder(rows, ids.map((r) => String(r.id)), (o) =>
      String(o.shopifyOrderId),
    );
  }

  async getQuotes(): Promise<Quote[]> {
    const ids = await this.quotes
      .createQueryBuilder('q')
      .select('q.id', 'id')
      .orderBy('q.createdAt', 'DESC')
      .limit(300)
      .getRawMany<{ id: string }>();
    if (!ids.length) return [];
    const rows = await this.quotes.find({
      where: { id: In(ids.map((r) => r.id)) },
    });
    return this.reorder(rows, ids.map((r) => r.id), (q) => q.id);
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
