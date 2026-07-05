import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ShopifyLineItem,
  ShopifyService,
} from '../shared/shopify.service';
import { EmailService } from '../shared/email.service';
import { CreateOrderDto, OrderItemDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly shopify: ShopifyService,
    private readonly email: EmailService,
  ) {}

  /** Convertit un item de commande en ligne Shopify (produit custom). */
  private toLineItem(item: OrderItemDto): ShopifyLineItem {
    const properties: Array<{ name: string; value: string }> = [];
    if (item.color) properties.push({ name: 'Couleur', value: item.color });
    if (item.size) properties.push({ name: 'Taille', value: item.size });
    if (item.properties) {
      for (const [name, value] of Object.entries(item.properties)) {
        properties.push({ name, value: String(value) });
      }
    }

    return {
      title: item.name,
      price: item.price.toString(),
      quantity: item.qty,
      custom: true,
      properties: properties.length ? properties : undefined,
    };
  }

  /**
   * Cree une commande : draft order Shopify + email de confirmation client.
   */
  async create(
    dto: CreateOrderDto,
  ): Promise<{ orderId: string | number; status: string }> {
    const { customer, items } = dto;

    const draftPayload = {
      line_items: items.map((it) => this.toLineItem(it)),
      customer: {
        email: customer.email,
        first_name: customer.prenom,
        last_name: customer.nom,
        phone: customer.telephone,
      },
      email: customer.email,
      note: customer.message
        ? `Commande configurateur. Message client: ${customer.message}`
        : 'Commande configurateur',
      tags: 'custom, personnalise, configurateur',
    };

    let draftOrder: Record<string, any>;
    try {
      draftOrder = await this.shopify.createDraftOrder(draftPayload);
    } catch (error) {
      this.logger.error(`Echec creation commande Shopify: ${(error as Error).message}`);
      throw new HttpException(
        `Impossible de creer la commande: ${(error as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Email de confirmation en best-effort (non bloquant) : la réponse HTTP
    // ne doit pas attendre le SMTP ni échouer si l'email ne part pas.
    void (async () => {
      try {
        await this.email.sendOrderConfirmation(customer.email, {
          customerName: `${customer.prenom} ${customer.nom}`,
          orderId: draftOrder.id,
          items: items.map((it) => ({
            name: it.name,
            color: it.color,
            size: it.size,
            qty: it.qty,
            price: it.price,
            img: it.img,
          })),
          total: dto.total,
        });
      } catch (error) {
        this.logger.warn(`Commande creee mais email non envoye: ${(error as Error).message}`);
      }
    })();

    return { orderId: draftOrder.id, status: draftOrder.status || 'open' };
  }

  /** Liste des commandes (draft orders Shopify). */
  async findAll(): Promise<Record<string, any>[]> {
    try {
      return await this.shopify.listDraftOrders(50);
    } catch (error) {
      throw new HttpException(
        `Impossible de recuperer les commandes: ${(error as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /** Detail d'une commande. */
  async findOne(id: string): Promise<Record<string, any>> {
    try {
      return await this.shopify.getDraftOrder(id);
    } catch (error) {
      throw new HttpException(
        `Commande introuvable: ${(error as Error).message}`,
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
