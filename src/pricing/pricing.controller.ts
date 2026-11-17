import { Controller, Get } from '@nestjs/common';
import { PricingService, type PricingPayload } from '../admin/pricing.service';
import { DelaisService, type Delais } from '../admin/delais.service';

/**
 * Prix du configurateur, en LECTURE SEULE et PUBLIC.
 *
 * Le configurateur (thème Shopify) appelle cet endpoint au chargement pour
 * afficher les prix définis par l'admin, au lieu de valeurs codées en dur.
 * L'écriture se fait uniquement depuis le dashboard (authentifié).
 */
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly delaisService: DelaisService,
  ) {}

  /**
   * GET /api/pricing — prix unitaires TTC par produit + grilles dégressives.
   *
   * `tiers` remplace la table qui était codée en dur dans le thème
   * (conf-pricing-tiers.js) : elle y sert désormais de simple repli si le
   * backend est injoignable.
   */
  @Get()
  async get(): Promise<{ ok: boolean; delais: Delais } & PricingPayload> {
    /* `delais` : délais de production réglés dans le dashboard (repli : le
       barème de conf-delais.js côté thème). */
    const [{ prices, tiers }, delais] = await Promise.all([
      this.pricing.getPayload(),
      this.delaisService.get(),
    ]);
    return { ok: true, prices, tiers, delais };
  }
}
