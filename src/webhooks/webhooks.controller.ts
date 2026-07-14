import {
  Controller,
  Post,
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

  /**
   * POST /api/webhooks/orders-updated
   * Reçoit l'événement orders/updated : c'est lui qui permet à un changement
   * fait DANS Shopify (mise en préparation, expédition) de se refléter
   * immédiatement dans le dashboard.
   */
  @Post('orders-updated')
  @HttpCode(HttpStatus.OK)
  async ordersUpdated(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-shopify-hmac-sha256') hmac?: string,
  ): Promise<{ ok: true }> {
    if (!this.webhooks.verifyHmac(req.rawBody as Buffer, hmac)) {
      throw new UnauthorizedException('Signature webhook invalide.');
    }

    const payload = (req.body || {}) as Record<string, any>;
    // Pas de notification : ce n'est pas une nouvelle commande.
    await this.webhooks.saveOrder(payload, false);
    // Puis on aligne le suivi sur l'état réel (« en préparation » n'est pas
    // dans le payload : il faut le lire sur les fulfillment orders).
    await this.webhooks.alignOne(String(payload.id));

    return { ok: true };
  }

  // NOTE : pas de route publique de listing ici. Les commandes contiennent des
  // données personnelles (nom, e-mail, adresse) : elles ne sont exposées que par
  // le dashboard admin, protégé par mot de passe (/api/admin).
}
