import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminSessionGuard } from './admin-session.guard';
import { SettingsModule } from './settings.module';
import { Order } from '../database/entities/order.entity';
import { Quote } from '../database/entities/quote.entity';
import { Design } from '../database/entities/design.entity';
import { Admin } from '../database/entities/admin.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, Quote, Design, Admin]),
    SettingsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminAuthService, AdminSessionGuard],
  /* Exportés pour que les autres modules (quotes, orders, uploads) puissent
     protéger leurs routes sensibles avec AdminSessionGuard. */
  exports: [AdminAuthService, AdminSessionGuard],
})
export class AdminModule {}
