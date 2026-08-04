import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { AdminSessionGuard } from '../admin/admin-session.guard';

/**
 * Contrôleur ENTIÈREMENT réservé aux admins.
 *
 * Vérifié dans le thème Shopify (customizer_frontend) : aucune de ces routes
 * n'y est appelée — le configurateur passe par le panier natif Shopify, les
 * devis et les uploads. En particulier `POST /api/orders` était public alors
 * que le prix (`item.price`) y était pris tel quel du client : on pouvait
 * commander un sweatshirt à 0,01 €. Le guard neutralise ce vecteur sans rien
 * casser côté thème.
 */
@UseGuards(AdminSessionGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** POST /api/orders — RÉSERVÉ AUX ADMINS (le prix client n'est pas de confiance). */
  @Post()
  create(
    @Body() dto: CreateOrderDto,
  ): Promise<{ orderId: string | number; status: string }> {
    return this.ordersService.create(dto);
  }

  /**
   * GET /api/orders — RÉSERVÉ AUX ADMINS.
   *
   * Renvoie les draft orders Shopify BRUTS : nom, e-mail, téléphone, adresses
   * de livraison et de facturation, montants, invoice_url.
   */
  @Get()
  findAll(): Promise<Record<string, any>[]> {
    return this.ordersService.findAll();
  }

  /** GET /api/orders/:id — RÉSERVÉ AUX ADMINS (mêmes données que ci-dessus). */
  @Get(':id')
  findOne(@Param('id') id: string): Promise<Record<string, any>> {
    return this.ordersService.findOne(id);
  }
}
