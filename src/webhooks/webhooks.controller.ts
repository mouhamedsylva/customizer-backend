import {
  Controller,
  Post,
  Get,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /**
   * POST /api/webhooks/orders-create
   * Reçoit chaque commande Shopify (événement orders/create), vérifie la
   * signature HMAC, puis enregistre la commande en base.
   *
   * IMPORTANT : cette route lit le corps BRUT (req.rawBody) pour le HMAC ;
   * la configuration est faite dans main.ts (rawBody: true).
   */
  @Post('orders-create')
  @HttpCode(HttpStatus.OK)
  async ordersCreate(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-shopify-hmac-sha256') hmac?: string,
  ): Promise<{ ok: true }> {
    const raw = req.rawBody;

    if (!this.webhooks.verifyHmac(raw as Buffer, hmac)) {
      // Signature invalide : on refuse (probable appel non authentifié).
      throw new UnauthorizedException('Signature webhook invalide.');
    }

    // Le corps a déjà été parsé par Nest ; on l'utilise directement.
    const payload = (req.body || {}) as Record<string, any>;
    await this.webhooks.saveOrder(payload);

    // Shopify attend un 200 rapide, sinon il retente.
    return { ok: true };
  }

  /** GET /api/webhooks/orders — liste des commandes captées (dashboard). */
  @Get('orders')
  listOrders() {
    return this.webhooks.findAll();
  }

  /**
   * GET /api/webhooks/scopes — diagnostic : permissions réelles du token Shopify.
   * Permet de vérifier la présence de read_orders / read_customers (sans ce
   * dernier, Shopify masque nom, email, téléphone et adresse détaillée).
   */
  @Get('scopes')
  async scopes() {
    return this.webhooks.getScopes();
  }

  /**
   * GET /api/webhooks/raw-order — diagnostic : JSON BRUT de la dernière commande
   * tel que l'API Shopify le renvoie. Permet de voir si les champs client sont
   * réellement fournis (ou masqués par la protection des données personnelles).
   */
  @Get('raw-order')
  async rawOrder() {
    return this.webhooks.debugRawOrder();
  }
}
