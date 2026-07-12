import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../database/entities/order.entity';
import { Quote } from '../database/entities/quote.entity';
import { Design } from '../database/entities/design.entity';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Quote) private readonly quotes: Repository<Quote>,
    @InjectRepository(Design) private readonly designs: Repository<Design>,
  ) {}

  async getOrders(): Promise<Order[]> {
    return this.orders.find({ order: { receivedAt: 'DESC' }, take: 500 });
  }

  async getQuotes(): Promise<Quote[]> {
    return this.quotes.find({ order: { createdAt: 'DESC' }, take: 500 });
  }

  async getDesigns(): Promise<Design[]> {
    return this.designs.find({ order: { createdAt: 'DESC' }, take: 500 });
  }

  /** Comptes pour les badges du dashboard. */
  async getCounts(): Promise<{ orders: number; quotes: number; designs: number }> {
    const [orders, quotes, designs] = await Promise.all([
      this.orders.count(),
      this.quotes.count(),
      this.designs.count(),
    ]);
    return { orders, quotes, designs };
  }
}
