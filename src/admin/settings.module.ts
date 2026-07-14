import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsService } from './settings.service';
import { Setting } from '../database/entities/setting.entity';

/**
 * Réglages de l'atelier (relances, notifications).
 * Module à part : le dashboard les édite, le service de relance les lit,
 * sans que Quotes et Admin dépendent l'un de l'autre.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Setting])],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
