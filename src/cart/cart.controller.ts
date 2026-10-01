import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CartService, PublicCart } from './cart.service';
import { AdminSessionGuard } from '../admin/admin-session.guard';
import { AddToCartDto } from './dto/add-to-cart.dto';

/**
 * Panier public du configurateur.
 *
 * Ces routes ne peuvent pas être authentifiées (le visiteur n'a pas de compte),
 * mais elles manipulent un draft order Shopify dont l'id est un entier
 * SÉQUENTIEL. La possession est donc prouvée par un `cartToken` signé, remis à
 * la création du panier et exigé ensuite.
 *
 * Le jeton est accepté dans l'en-tête `X-Cart-Token` OU en query `?token=`.
 * L'en-tête est à privilégier — une query apparaît dans les logs d'accès du
 * proxy, dans l'historique du navigateur et dans le `Referer` sortant. La query
 * reste acceptée parce que certains contextes du thème ne peuvent pas poser
 * d'en-tête ; la supprimer exigerait de le vérifier d'abord côté frontend.
 */
/* FERMÉ AU PUBLIC (1er octobre 2026). Le thème n'appelle PAS ces routes : il
   utilise le panier natif Shopify (/cart/add.js). Ouvertes, elles
   permettaient à n'importe qui de créer des brouillons Shopify (variant et
   quantité libres), qui encombraient l'admin Shopify et consommaient le
   quota d'API partagé avec les factures et la synchro. Réservées à l'admin
   jusqu'à un éventuel usage réel. */
@UseGuards(AdminSessionGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  /* LIMITES PROPRES : chaque appel coûte 1 à 3 requêtes Shopify, sur un quota
     (~2/s) PARTAGÉ avec les factures, les relances et la synchro. Au plafond
     global (120/min), un seul visiteur épuisait ce quota pour tout le backend.
     Largement au-dessus d'un usage réel (quelques ajouts par session). */

  /** POST /api/cart/add */
  @Post('add')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  add(@Body() dto: AddToCartDto): Promise<PublicCart> {
    return this.cartService.add(dto);
  }

  /** GET /api/cart/:draftOrderId — exige le jeton du panier. */
  @Get(':draftOrderId')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  get(
    @Param('draftOrderId') draftOrderId: string,
    @Headers('x-cart-token') headerToken?: string,
    @Query('token') queryToken?: string,
  ): Promise<PublicCart> {
    return this.cartService.get(draftOrderId, headerToken || queryToken);
  }

  /** DELETE /api/cart/:draftOrderId/item/:lineId — exige le jeton du panier. */
  @Delete(':draftOrderId/item/:lineId')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  removeItem(
    @Param('draftOrderId') draftOrderId: string,
    @Param('lineId') lineId: string,
    @Headers('x-cart-token') headerToken?: string,
    @Query('token') queryToken?: string,
  ): Promise<PublicCart> {
    return this.cartService.removeItem(
      draftOrderId,
      lineId,
      headerToken || queryToken,
    );
  }
}
