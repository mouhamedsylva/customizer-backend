import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  /** POST /api/cart/add */
  @Post('add')
  add(@Body() dto: AddToCartDto): Promise<Record<string, any>> {
    return this.cartService.add(dto);
  }

  /** GET /api/cart/:draftOrderId */
  @Get(':draftOrderId')
  get(@Param('draftOrderId') draftOrderId: string): Promise<Record<string, any>> {
    return this.cartService.get(draftOrderId);
  }

  /** DELETE /api/cart/:draftOrderId/item/:lineId */
  @Delete(':draftOrderId/item/:lineId')
  removeItem(
    @Param('draftOrderId') draftOrderId: string,
    @Param('lineId') lineId: string,
  ): Promise<Record<string, any>> {
    return this.cartService.removeItem(draftOrderId, lineId);
  }
}
