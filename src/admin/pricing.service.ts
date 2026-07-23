import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../database/entities/setting.entity';

/**
 * Clés des produits du configurateur. Elles correspondent aux types utilisés
 * côté frontend (window.CONF_VARIANTS) et servent de clé de réglage.
 */
export const PRODUCT_KEYS = [
  'sweatshirt',
  'tshirt',
  'tshirt_polyester',
  'coins',
  'drapeaux',
  'patches',
] as const;

export type ProductKey = (typeof PRODUCT_KEYS)[number];

/** Libellés affichés dans le dashboard. */
export const PRODUCT_LABELS: Record<ProductKey, string> = {
  sweatshirt: 'Sweatshirt',
  tshirt: 'T-shirt coton',
  tshirt_polyester: 'T-shirt polyester',
  coins: 'Coins',
  drapeaux: 'Drapeaux',
  patches: 'Patchs',
};

/** Prix unitaires HT par produit. */
export type Pricing = Record<ProductKey, number>;

/**
 * Prix par défaut : ceux qui étaient codés en dur dans le configurateur.
 * Servent de valeur initiale tant que l'admin n'a rien enregistré.
 */
const DEFAULTS: Pricing = {
  sweatshirt: 60,
  tshirt: 29.5,
  tshirt_polyester: 29.5,
  coins: 2.45,
  drapeaux: 19.9,
  patches: 2.45,
};

/** Préfixe des clés dans la table `settings` (ex. `price_patches`). */
const KEY_PREFIX = 'price_';

/**
 * PRODUIT Shopify de chaque type du configurateur.
 *
 * On cible le PRODUIT (et non un variant) pour deux raisons :
 *  - les textiles ont 15 variants (un par couleur) : changer le prix doit tous
 *    les mettre à jour, pas un seul ;
 *  - les ids de variants changent quand on régénère les déclinaisons, alors que
 *    l'id du produit reste stable.
 *
 * `coins` est inclus : son produit existe, même si la vente passe par un devis.
 */
export const PRODUCT_SHOPIFY_IDS: Partial<Record<ProductKey, string>> = {
  sweatshirt: '9167767240867', // Textile - Sweatshirt        (15 variants)
  tshirt: '9167767404707', // Textile - T-shirt Coton     (15 variants)
  tshirt_polyester: '9167767732387', // Textile - T-shirt Polyester (15 variants)
  drapeaux: '9167767928995', // Drapeau personnalisé        (1 variant)
  patches: '9167772254371', // Patch personnalisé          (1 variant)
  // coins : vendu via devis (draft order), prix chiffré à la main -> non synchronisé.
};

/**
 * Produits à DÉCLINAISONS (couleurs/tailles) : leur prix est unique et
 * s'applique à tous leurs variants. Sert au dashboard pour l'indiquer
 * clairement à l'admin.
 */
export const MULTI_VARIANT_KEYS: ProductKey[] = [
  'sweatshirt',
  'tshirt',
  'tshirt_polyester',
];

/**
 * Prix unitaires du configurateur, modifiables depuis le dashboard.
 *
 * Stockés dans la table clé/valeur `settings` : pas de migration, et le
 * frontend les lit via un endpoint public (GET /api/pricing).
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @InjectRepository(Setting)
    private readonly repo: Repository<Setting>,
  ) {}

  /** Prix de tous les produits (valeurs par défaut si non configurées). */
  async get(): Promise<Pricing> {
    const rows = await this.repo.find();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const out = { ...DEFAULTS };
    for (const key of PRODUCT_KEYS) {
      const raw = map.get(KEY_PREFIX + key);
      const n = raw != null ? Number(raw) : NaN;
      if (!Number.isNaN(n) && n >= 0) out[key] = n;
    }
    return out;
  }

  /**
   * Enregistre les prix fournis (partiel accepté). Ignore les valeurs
   * invalides (non numériques ou négatives) et renvoie les prix à jour.
   */
  async save(input: Partial<Record<ProductKey, unknown>>): Promise<Pricing> {
    for (const key of PRODUCT_KEYS) {
      if (!(key in input)) continue;
      const n = Number(input[key]);
      if (Number.isNaN(n) || n < 0) continue;
      // Deux décimales : un prix n'a pas plus de précision.
      const value = (Math.round(n * 100) / 100).toFixed(2);
      await this.repo.save({ key: KEY_PREFIX + key, value });
    }
    return this.get();
  }
}
