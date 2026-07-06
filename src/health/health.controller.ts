import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShopifyService } from '../shared/shopify.service';

// Product IDs fournis pour le panier natif (drapeaux + textiles).
// Coins = devis (draft order), donc pas de variant panier.
const CONFIG_PRODUCTS: Record<string, string> = {
  drapeaux: '9167767928995',
  tshirt_polyester: '9167767732387',
  tshirt: '9167767404707',
  sweatshirt: '9167767240867',
};

@Controller('health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly shopify: ShopifyService,
  ) {}

  /** GET /api/health */
  @Get()
  check(): { status: string; timestamp: string; environment: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: this.config.get<string>('NODE_ENV') || 'development',
    };
  }

  /**
   * GET /api/health/variants
   * Debug : renvoie, pour chaque produit du configurateur, son/ses variant_id.
   * A utiliser une fois pour remplir les window.CONF_VARIANT_* cote Liquid.
   */
  @Get('variants')
  async variants(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [key, productId] of Object.entries(CONFIG_PRODUCTS)) {
      try {
        const p = await this.shopify.getProductVariants(productId);
        out[key] = {
          productId,
          title: p.title,
          // Le 1er variant suffit (produit a prix fixe, variant unique).
          variantId: p.variants[0]?.id ?? null,
          price: p.variants[0]?.price ?? null,
          allVariants: p.variants,
        };
      } catch (error) {
        out[key] = { productId, error: (error as Error).message };
      }
    }
    return out;
  }
}
