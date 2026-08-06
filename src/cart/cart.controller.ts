import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CartService, PublicCart } from './cart.service';
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
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  /** POST /api/cart/add */
  @Post('add')
  add(@Body() dto: AddToCartDto): Promise<PublicCart> {
    return this.cartService.add(dto);
  }

  /** GET /api/cart/:draftOrderId — exige le jeton du panier. */
  @Get(':draftOrderId')
  get(
    @Param('draftOrderId') draftOrderId: string,
    @Headers('x-cart-token') headerToken?: string,
    @Query('token') queryToken?: string,
  ): Promise<PublicCart> {
    return this.cartService.get(draftOrderId, headerToken || queryToken);
  }

  /** DELETE /api/cart/:draftOrderId/item/:lineId — exige le jeton du panier. */
  @Delete(':draftOrderId/item/:lineId')
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
