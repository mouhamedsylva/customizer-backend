import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** POST /api/orders */
  @Post()
  create(
    @Body() dto: CreateOrderDto,
  ): Promise<{ orderId: string | number; status: string }> {
    return this.ordersService.create(dto);
  }

  /** GET /api/orders */
  @Get()
  findAll(): Promise<Record<string, any>[]> {
    return this.ordersService.findAll();
  }

  /** GET /api/orders/:id */
  @Get(':id')
  findOne(@Param('id') id: string): Promise<Record<string, any>> {
    return this.ordersService.findOne(id);
  }
}
