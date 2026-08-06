import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AdminModule } from '../admin/admin.module';

@Module({
  /* AdminModule fournit AdminSessionGuard, qui protège GET /api/health/variants
     (5 appels Shopify par requête). Pas de cycle : AdminModule n'importe pas
     ce module. */
  imports: [AdminModule],
  controllers: [HealthController],
})
export class HealthModule {}
