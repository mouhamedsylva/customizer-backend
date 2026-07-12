import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAuthService } from './admin-auth.service';
import { Order } from '../database/entities/order.entity';
import { Quote } from '../database/entities/quote.entity';
import { Design } from '../database/entities/design.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Quote, Design])],
  controllers: [AdminController],
  providers: [AdminService, AdminAuthService],
})
export class AdminModule {}
