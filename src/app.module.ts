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
import { Design } from './database/entities/design.entity';
import { Quote } from './database/entities/quote.entity';

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
        entities: [Design, Quote],
        // Crée/adapte les tables automatiquement au démarrage (étape 1).
        synchronize: true,
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
  ],
})
export class AppModule {}
