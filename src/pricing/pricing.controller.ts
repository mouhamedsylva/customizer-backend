import { Controller, Get } from '@nestjs/common';
import { PricingService } from '../admin/pricing.service';

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

  /** GET /api/pricing — prix unitaires HT par produit. */
  @Get()
  async get(): Promise<{ ok: boolean; prices: Record<string, number> }> {
    const prices = await this.pricing.get();
    return { ok: true, prices };
  }
}
