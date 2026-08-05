import { Global, Module } from '@nestjs/common';
import { ShopifyService } from './shopify.service';
import { CloudinaryService } from './cloudinary.service';

/**
 * Module partage regroupant les services d'integration (Shopify, Cloudinary).
 * Declare @Global pour etre injectable partout sans re-import.
 *
 * Il n'y a plus de service d'e-mail : toute la correspondance client passe par
 * Shopify (confirmation de commande, facture de devis, relances, expedition).
 */
@Global()
@Module({
  providers: [ShopifyService, CloudinaryService],
  exports: [ShopifyService, CloudinaryService],
})
export class SharedModule {}
