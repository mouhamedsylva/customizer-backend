import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ShopifyLineItem,
  ShopifyService,
} from '../shared/shopify.service';
import { AddToCartDto } from './dto/add-to-cart.dto';

/**
 * Service panier : le panier est materialise par un draft order Shopify.
 * Le panier AJAX Shopify (/cart/add.js) etant cote navigateur, on passe ici
 * par l'API Admin (draft orders) pour manipuler le panier cote serveur.
 */
@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(private readonly shopify: ShopifyService) {}

  /** Transforme un objet properties {cle: valeur} en tableau attendu par Shopify. */
  private toShopifyProperties(
    props?: Record<string, string>,
  ): Array<{ name: string; value: string }> | undefined {
    if (!props) return undefined;
    return Object.entries(props).map(([name, value]) => ({
      name,
      value: String(value),
    }));
  }

  /**
   * Ajoute une ligne au panier.
   * Sans draftOrderId : cree un nouveau draft order.
   * Avec draftOrderId : ajoute la ligne au draft existant.
   */
  async add(dto: AddToCartDto): Promise<Record<string, any>> {
    const newLine: ShopifyLineItem = {
      variant_id: dto.variantId,
      quantity: dto.quantity,
      properties: this.toShopifyProperties(dto.properties),
    };

    try {
      if (!dto.draftOrderId) {
        return await this.shopify.createDraftOrder({ line_items: [newLine] });
      }

      // On recupere le panier existant, on concatene la nouvelle ligne, on met a jour.
      const draft = await this.shopify.getDraftOrder(dto.draftOrderId);
      const existing: ShopifyLineItem[] = (draft.line_items || []).map(
        (li: Record<string, any>) =>
          li.variant_id
            ? {
                variant_id: li.variant_id,
                quantity: li.quantity,
                properties: li.properties,
              }
            : {
                title: li.title,
                price: li.price,
                quantity: li.quantity,
                custom: true,
                properties: li.properties,
              },
      );
      return await this.shopify.updateDraftOrderLineItems(dto.draftOrderId, [
        ...existing,
        newLine,
      ]);
    } catch (error) {
      this.logger.error(`Erreur ajout panier: ${(error as Error).message}`);
      throw new HttpException(
        `Impossible d'ajouter au panier: ${(error as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /** Recupere le contenu d'un panier (draft order). */
  async get(draftOrderId: string): Promise<Record<string, any>> {
    try {
      return await this.shopify.getDraftOrder(draftOrderId);
    } catch (error) {
      throw new HttpException(
        `Panier introuvable: ${(error as Error).message}`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /** Retire une ligne d'un panier. */
  async removeItem(
    draftOrderId: string,
    lineId: string,
  ): Promise<Record<string, any>> {
    try {
      return await this.shopify.deleteDraftOrderLine(draftOrderId, lineId);
    } catch (error) {
      throw new HttpException(
        `Impossible de retirer l'article: ${(error as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
