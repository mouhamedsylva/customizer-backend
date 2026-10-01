import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartTokenService } from './cart-token.service';
import { Setting } from '../database/entities/setting.entity';
import { AdminModule } from '../admin/admin.module';

@Module({
  /* Setting : CartTokenService y persiste le secret de signature des jetons de
     panier, pour qu'ils survivent aux redémarrages. */
  // AdminModule : AdminSessionGuard, qui ferme désormais ces routes (voir le contrôleur).
  imports: [TypeOrmModule.forFeature([Setting]), AdminModule],
  controllers: [CartController],
  providers: [CartService, CartTokenService],
})
export class CartModule {}
