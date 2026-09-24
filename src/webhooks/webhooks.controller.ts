import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';

/**
 * Le limiteur global (120 req/min par IP, app.module.ts) ne s'applique PAS ici.
 *
 * Shopify émet depuis un parc d'adresses mutualisé : une opération groupée sur
 * la boutique — import de commandes, modification en lot — produit une rafale
 * qui dépassait ce seuil et se voyait refuser en 429. Shopify réessaie, mais
 * il consomme alors son budget de tentatives, et une commande finit par être
 * perdue pour de bon.
 *
 * La protection de cette route n'est pas le comptage : c'est la signature
 * HMAC, vérifiée à chaque appel avant toute écriture. Une requête non signée
 * est rejetée quoi qu'il arrive.
 */
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /**
   * POST /api/webhooks/orders-create
   * Reçoit chaque commande Shopify (événement orders/create), vérifie la
   * signature HMAC, puis enregistre la commande en base.
   *
   * IMPORTANT : cette route lit le corps BRUT (req.rawBody) pour le HMAC. Il
   * est conservé par le callback `verify` du middleware `json()` dans main.ts,
   * qui ne l'active que sur les chemins commençant par `/api/webhooks/`.
   */
  @Post('orders-create')
  @HttpCode(HttpStatus.OK)
  async ordersCreate(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-shopify-hmac-sha256') hmac?: string,
    @Headers('x-shopify-shop-domain') shop?: string,
  ): Promise<{ ok: true }> {
    const raw = req.rawBody;

    if (!this.webhooks.verifyHmac(raw as Buffer, hmac)) {
      // Signature invalide : on refuse (probable appel non authentifié).
      throw new UnauthorizedException('Signature webhook invalide.');
    }
    this.webhooks.verifierBoutique(shop);

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
    @Headers('x-shopify-shop-domain') shop?: string,
  ): Promise<{ ok: true }> {
    if (!this.webhooks.verifyHmac(req.rawBody as Buffer, hmac)) {
      throw new UnauthorizedException('Signature webhook invalide.');
    }
    this.webhooks.verifierBoutique(shop);

    const payload = (req.body || {}) as Record<string, any>;
    await this.webhooks.saveOrder(payload);
    // Puis on aligne le suivi sur l'état réel (« en préparation » n'est pas
    // dans le payload : il faut le lire sur les fulfillment orders).
    await this.webhooks.alignOne(String(payload.id));

    return { ok: true };
  }

  // NOTE : pas de route publique de listing ici. Les commandes contiennent des
  // données personnelles (nom, e-mail, adresse) : elles ne sont exposées que par
  // le dashboard admin, protégé par mot de passe (/api/admin).
}
