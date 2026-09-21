import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShopifyService } from './shopify.service';
import { CloudinaryService } from './cloudinary.service';
import { TextSvgService } from './text-svg.service';
import { CleanupService } from './cleanup.service';
import { Quote } from '../database/entities/quote.entity';

/**
 * Module partage regroupant les services d'integration (Shopify, Cloudinary, TextSvg, Cleanup).
 * Declare @Global pour etre injectable partout sans re-import.
 *
 * Il n'y a plus de service d'e-mail : toute la correspondance client passe par
 * Shopify (confirmation de commande, facture de devis, relances, expedition).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Quote])],
  providers: [ShopifyService, CloudinaryService, TextSvgService, CleanupService],
  exports: [ShopifyService, CloudinaryService, TextSvgService, CleanupService],
})
export class SharedModule {}
