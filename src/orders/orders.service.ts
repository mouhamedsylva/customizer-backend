import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ShopifyLineItem,
  ShopifyService,
} from '../shared/shopify.service';
import { throwUpstream } from '../shared/upstream-error';
import { CreateOrderDto, OrderItemDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly shopify: ShopifyService) {}

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
   * Cree une commande : draft order Shopify.
   *
   * Aucun e-mail n'est emis ici : Shopify envoie sa propre confirmation au
   * client, ainsi que la facture du brouillon et l'avis d'expedition.
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
      throwUpstream(this.logger, 'Impossible de créer la commande.', error);
    }

    return { orderId: draftOrder.id, status: draftOrder.status || 'open' };
  }

  /** Liste des commandes (draft orders Shopify). */
  async findAll(): Promise<Record<string, any>[]> {
    try {
      return await this.shopify.listDraftOrders(50);
    } catch (error) {
      throwUpstream(this.logger, 'Impossible de récupérer les commandes.', error);
    }
  }

  /** Detail d'une commande. */
  async findOne(id: string): Promise<Record<string, any>> {
    try {
      return await this.shopify.getDraftOrder(id);
    } catch (error) {
      throwUpstream(
        this.logger,
        'Commande introuvable.',
        error,
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
