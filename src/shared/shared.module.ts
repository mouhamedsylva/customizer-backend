import { Global, Module } from '@nestjs/common';
import { ShopifyService } from './shopify.service';
import { EmailService } from './email.service';
import { CloudinaryService } from './cloudinary.service';

/**
 * Module partage regroupant les services d'integration (Shopify, Email, Cloudinary).
 * Declare @Global pour etre injectable partout sans re-import.
 */
@Global()
@Module({
  providers: [ShopifyService, EmailService, CloudinaryService],
  exports: [ShopifyService, EmailService, CloudinaryService],
})
export class SharedModule {}
