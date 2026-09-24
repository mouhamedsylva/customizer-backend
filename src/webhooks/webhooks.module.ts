import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { SettingsModule } from '../admin/settings.module';
import { Order } from '../database/entities/order.entity';
import { Quote } from '../database/entities/quote.entity';

/* `Quote` est déclaré ICI en plus de `Order` : sans lui, le service n'avait
   aucun accès au dépôt des devis, et le rattachement d'une commande payée à
   son devis était structurellement impossible depuis le webhook. Il reposait
   alors entièrement sur une synchro de 10 minutes interrogeant Shopify. */
@Module({
  imports: [TypeOrmModule.forFeature([Order, Quote]), SettingsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
