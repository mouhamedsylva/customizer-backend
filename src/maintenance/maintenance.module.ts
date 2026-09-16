import { Module } from '@nestjs/common';
import { MaintenanceController } from './maintenance.controller';
import { SettingsModule } from '../admin/settings.module';

/**
 * Exposition PUBLIQUE du mode maintenance au configurateur (lecture seule).
 *
 * Le service vit dans SettingsModule : une seule source de vérité, partagée
 * avec le dashboard qui, lui, peut la modifier. Même montage que PricingModule.
 */
@Module({
  imports: [SettingsModule],
  controllers: [MaintenanceController],
})
export class MaintenanceModule {}
