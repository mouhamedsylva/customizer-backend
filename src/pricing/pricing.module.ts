import { Module } from '@nestjs/common';
import { PricingController } from './pricing.controller';
import { SettingsModule } from '../admin/settings.module';

/**
 * Exposition PUBLIQUE des prix au configurateur (lecture seule).
 * Le service vit dans SettingsModule : une seule source de vérité, partagée
 * avec le dashboard qui, lui, peut les modifier.
 */
@Module({
  imports: [SettingsModule],
  controllers: [PricingController],
})
export class PricingModule {}
