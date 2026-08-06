import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartTokenService } from './cart-token.service';
import { Setting } from '../database/entities/setting.entity';

@Module({
  /* Setting : CartTokenService y persiste le secret de signature des jetons de
     panier, pour qu'ils survivent aux redémarrages. */
  imports: [TypeOrmModule.forFeature([Setting])],
  controllers: [CartController],
  providers: [CartService, CartTokenService],
})
export class CartModule {}
