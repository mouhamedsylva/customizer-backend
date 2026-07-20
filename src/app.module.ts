import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from './shared/shared.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { QuotesModule } from './quotes/quotes.module';
import { UploadsModule } from './uploads/uploads.module';
import { ExportModule } from './export/export.module';
import { HealthModule } from './health/health.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AdminModule } from './admin/admin.module';
import { PricingModule } from './pricing/pricing.module';
import { Design } from './database/entities/design.entity';
import { Quote } from './database/entities/quote.entity';
import { Order } from './database/entities/order.entity';
import { Setting } from './database/entities/setting.entity';
import { Admin } from './database/entities/admin.entity';

@Module({
  imports: [
    // Chargement des variables d'environnement, disponible globalement.
    ConfigModule.forRoot({ isGlobal: true }),

    // Connexion MySQL (Railway fournit la variable MYSQL_URL).
    // Si MYSQL_URL est absente (dev local sans BDD), la connexion échoue au
    // démarrage : renseigne la variable ou lance MySQL localement.
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        url:
          config.get<string>('MYSQL_URL') ||
          config.get<string>('DATABASE_URL'),
        entities: [Design, Quote, Order, Setting, Admin],
        // Adaptation automatique du schéma au démarrage.
        //
        // DANGER : synchronize fait ALTER/DROP pour aligner la base sur les
        // entités. Renommer ou supprimer un champ DÉTRUIT la colonne et ses
        // données, sans confirmation. Les tables existent déjà en production :
        // laisser ceci actif n'apporte rien et risque tout.
        //
        // Opt-in explicite (et non « désactivé si NODE_ENV=production ») :
        // NODE_ENV n'est pas défini sur l'instance Railway, un test sur sa
        // valeur laisserait donc synchronize actif en production.
        synchronize: config.get<string>('DB_SYNCHRONIZE') === 'true',
        // Railway MySQL n'exige pas de TLS strict ; on reste tolérant.
        autoLoadEntities: true,
      }),
    }),

    SharedModule,
    CartModule,
    OrdersModule,
    QuotesModule,
    UploadsModule,
    ExportModule,
    HealthModule,
    WebhooksModule,
    AdminModule,
    PricingModule,
  ],
})
export class AppModule {}
