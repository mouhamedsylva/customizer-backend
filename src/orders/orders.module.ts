import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { AdminModule } from '../admin/admin.module';

@Module({
  /* AdminModule fournit AdminSessionGuard, qui protège les routes de lecture
     (données personnelles clients). Pas de cycle : AdminModule n'importe pas
     ce module. */
  imports: [AdminModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
