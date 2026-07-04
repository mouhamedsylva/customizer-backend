import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SharedModule } from './shared/shared.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { QuotesModule } from './quotes/quotes.module';
import { UploadsModule } from './uploads/uploads.module';
import { ExportModule } from './export/export.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // Chargement des variables d'environnement, disponible globalement.
    ConfigModule.forRoot({ isGlobal: true }),
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
