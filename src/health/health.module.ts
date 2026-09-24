import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AdminModule } from '../admin/admin.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  /* AdminModule fournit AdminSessionGuard, qui protège GET /api/health/variants
     (5 appels Shopify par requête). Pas de cycle : AdminModule n'importe pas
     ce module.

     WebhooksModule expose l'état de la synchro des commandes, pour que la
     supervision puisse détecter son arrêt. Il exporte déjà son service, et
     n'importe pas ce module : pas de cycle non plus. */
  imports: [AdminModule, WebhooksModule],
  controllers: [HealthController],
})
export class HealthModule {}
