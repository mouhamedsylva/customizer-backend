import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsService } from './settings.service';
import { PricingService } from './pricing.service';
import { DelaisService } from './delais.service';
import { Setting } from '../database/entities/setting.entity';

/**
 * Réglages de l'atelier (relances, notifications) et PRIX du configurateur.
 * Module à part : le dashboard les édite, le service de relance et le
 * configurateur les lisent, sans dépendance croisée entre Quotes et Admin.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Setting])],
  providers: [SettingsService, PricingService, DelaisService],
  exports: [SettingsService, PricingService, DelaisService],
})
export class SettingsModule {}
