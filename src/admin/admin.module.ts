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
import { Setting } from '../database/entities/setting.entity';

@Module({
  imports: [
    /* Setting : AdminAuthService y persiste le secret de session auto-généré
       quand ADMIN_SESSION_SECRET n'est pas fourni. */
    TypeOrmModule.forFeature([Order, Quote, Design, Admin, Setting]),
    SettingsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminAuthService, AdminSessionGuard],
  /* Exportés pour que les autres modules (quotes, orders, uploads) puissent
     protéger leurs routes sensibles avec AdminSessionGuard. */
  exports: [AdminAuthService, AdminSessionGuard],
})
export class AdminModule {}
