import { Controller, Get } from '@nestjs/common';
import { PricingService, type PricingPayload } from '../admin/pricing.service';

/**
 * Prix du configurateur, en LECTURE SEULE et PUBLIC.
 *
 * Le configurateur (thème Shopify) appelle cet endpoint au chargement pour
 * afficher les prix définis par l'admin, au lieu de valeurs codées en dur.
 * L'écriture se fait uniquement depuis le dashboard (authentifié).
 */
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /**
   * GET /api/pricing — prix unitaires HT par produit + grilles dégressives.
   *
   * `tiers` remplace la table qui était codée en dur dans le thème
   * (conf-pricing-tiers.js) : elle y sert désormais de simple repli si le
   * backend est injoignable.
   */
  @Get()
  async get(): Promise<{ ok: boolean } & PricingPayload> {
    const { prices, tiers } = await this.pricing.getPayload();
    return { ok: true, prices, tiers };
  }
}
