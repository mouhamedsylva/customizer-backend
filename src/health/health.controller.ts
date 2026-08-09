import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShopifyService } from '../shared/shopify.service';
import { AdminSessionGuard } from '../admin/admin-session.guard';
import { PRODUCT_SHOPIFY_IDS } from '../admin/pricing.service';

/**
 * Produits interrogés par la route de debug `variants`.
 *
 * Réutilise `PRODUCT_SHOPIFY_IDS` au lieu d'en tenir une copie. Le doublon qui
 * existait ici avait DÉJÀ dérivé : il ignorait la « Personnalisation manche »,
 * ajoutée depuis. Deux listes d'identifiants Shopify qui divergent en silence,
 * c'est exactement ce qui rend un diagnostic trompeur — la route de debug
 * affirmait une configuration qui n'était plus celle du configurateur.
 *
 * `coins` en est absent (vente sur devis, aucun produit à synchroniser), ce
 * qui reste le comportement voulu ici.
 */
const CONFIG_PRODUCTS: Record<string, string> = PRODUCT_SHOPIFY_IDS;

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

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
   * GET /api/health/variants — RÉSERVÉ AUX ADMINS.
   *
   * Debug : renvoie, pour chaque produit du configurateur, son/ses variant_id.
   * A utiliser une fois pour remplir les window.CONF_VARIANT_* cote Liquid.
   *
   * Cette route était PUBLIQUE alors qu'elle déclenche 5 appels séquentiels à
   * l'API Admin Shopify. Le quota REST de Shopify étant d'environ 120 appels
   * par minute, une seule IP tapant au plafond du rate limiting (120 req/min)
   * en consommait 600 — Shopify répondait alors 429 à TOUT le backend :
   * création de devis, envoi de factures et synchro des commandes tombaient
   * ensemble. Une route de debug ne doit pas pouvoir couper la production.
   */
  @UseGuards(AdminSessionGuard)
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
        // Message générique : le détail (qui contenait l'URL Shopify complète
        // et la version d'API en cas de timeout) reste dans les logs serveur.
        this.logger.warn(
          `Lecture des variants ${productId} échouée : ${(error as Error).message}`,
        );
        out[key] = { productId, error: 'Lecture Shopify impossible.' };
      }
    }
    return out;
  }
}
