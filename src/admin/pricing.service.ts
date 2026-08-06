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
 * Palier de tarif dégressif : à partir de `min` articles, l'unité vaut `price`.
 */
export interface Tier {
  min: number;
  price: number;
}

/** Grilles dégressives par produit. Un produit absent n'est pas dégressif. */
export type Tiers = Partial<Record<ProductKey, Tier[]>>;

/** Prix de base + grilles dégressives, tels que servis au configurateur. */
export interface PricingPayload {
  prices: Pricing;
  tiers: Tiers;
}

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
  /* 20 € = premier palier de la grille atelier (10 articles, le minimum de
     commande). La valeur précédente (2,45 €) était celle des coins, restée là
     par copie : elle contredisait la grille dégressive. */
  patches: 20,
};

/**
 * Grilles dégressives par défaut.
 *
 * Reprises de conf-pricing-tiers.js (frontend), où elles étaient codées en
 * dur : elles ne servent plus que de valeur initiale tant que l'admin n'a
 * rien enregistré. Paliers triés du plus grand `min` au plus petit —
 * tierUnitPrice() retient le premier atteint.
 *
 * Les produits absents (coins, drapeaux) ne sont pas dégressifs.
 */
const DEFAULT_TIERS: Tiers = {
  sweatshirt: [
    { min: 40, price: 52.0 },
    { min: 15, price: 53.9 },
    { min: 5, price: 56.5 },
    { min: 1, price: 60.0 },
  ],
  tshirt: [
    { min: 50, price: 24.5 },
    { min: 20, price: 25.9 },
    { min: 10, price: 26.5 },
    { min: 5, price: 28.9 },
    { min: 1, price: 29.5 },
  ],
  tshirt_polyester: [
    { min: 50, price: 24.5 },
    { min: 20, price: 25.9 },
    { min: 10, price: 26.5 },
    { min: 5, price: 28.9 },
    { min: 1, price: 29.5 },
  ],
  // Grille atelier : au-delà de 100, le devis prend le relais (géré côté UI).
  patches: [
    { min: 100, price: 3.5 },
    { min: 50, price: 5.0 },
    { min: 30, price: 9.0 },
    { min: 20, price: 12.5 },
    { min: 10, price: 20.0 },
  ],
};

/** Préfixe des clés dans la table `settings` (ex. `price_patches`). */
const KEY_PREFIX = 'price_';

/** Préfixe des grilles dégressives (ex. `tiers_sweatshirt`), stockées en JSON. */
const TIERS_PREFIX = 'tiers_';

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
   *
   * Toutes les lignes sont écrites dans UNE transaction. La boucle de `save()`
   * successifs laissait, en cas d'interruption, une grille de prix à moitié
   * appliquée : quelques produits au nouveau tarif, les autres à l'ancien,
   * sans que rien ne le signale. Sur des prix affichés au client, une
   * incohérence partielle est pire qu'un échec franc — ici, soit tout passe,
   * soit rien ne change.
   */
  async save(input: Partial<Record<ProductKey, unknown>>): Promise<Pricing> {
    const rows: Array<{ key: string; value: string }> = [];
    for (const key of PRODUCT_KEYS) {
      if (!(key in input)) continue;
      const n = Number(input[key]);
      if (Number.isNaN(n) || n < 0) continue;
      // Deux décimales : un prix n'a pas plus de précision.
      const value = (Math.round(n * 100) / 100).toFixed(2);
      rows.push({ key: KEY_PREFIX + key, value });
    }
    if (rows.length) {
      await this.repo.manager.transaction(async (trx) => {
        await trx.getRepository(Setting).save(rows);
      });
    }
    return this.get();
  }

  /**
   * Grilles dégressives de tous les produits.
   * Une grille enregistrée remplace entièrement celle par défaut ; une grille
   * vide (`[]`) signifie « ce produit n'est plus dégressif ».
   */
  async getTiers(): Promise<Tiers> {
    const rows = await this.repo.find();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const out: Tiers = {};

    for (const key of PRODUCT_KEYS) {
      const raw = map.get(TIERS_PREFIX + key);
      if (raw == null) {
        // Rien en base : on retombe sur la grille d'origine, s'il y en a une.
        if (DEFAULT_TIERS[key]) out[key] = DEFAULT_TIERS[key]!.map((t) => ({ ...t }));
        continue;
      }
      // Grille vide volontaire : le produit cesse d'être dégressif. On pose la
      // clé avec un tableau vide plutôt que de l'omettre — l'omission était
      // indiscernable de « jamais configuré », si bien que le thème retombait
      // sur sa grille codée en dur et l'admin ne pouvait PAS désactiver la
      // dégressivité d'un produit.
      out[key] = this.parseTiers(raw);
    }
    return out;
  }

  /**
   * Enregistre les grilles fournies (partiel accepté).
   *
   * Chaque grille est nettoyée avant écriture : paliers invalides écartés,
   * doublons de `min` fusionnés, tri décroissant. Le frontend peut ainsi
   * consommer la table telle quelle, sans la retrier.
   */
  async saveTiers(input: Record<string, unknown>): Promise<Tiers> {
    const rows: Array<{ key: string; value: string }> = [];
    for (const key of PRODUCT_KEYS) {
      if (!(key in input)) continue;
      const clean = this.normalizeTiers(input[key]);
      rows.push({
        key: TIERS_PREFIX + key,
        value: JSON.stringify(clean),
      });
    }
    // Une transaction, pour la même raison que `save()` : une grille
    // dégressive à moitié écrite produirait des prix incohérents entre
    // produits, sans aucun signal.
    if (rows.length) {
      await this.repo.manager.transaction(async (trx) => {
        await trx.getRepository(Setting).save(rows);
      });
    }
    return this.getTiers();
  }

  /** Prix de base + grilles, en une seule lecture pour le configurateur. */
  async getPayload(): Promise<PricingPayload> {
    const [prices, tiers] = await Promise.all([this.get(), this.getTiers()]);
    return { prices, tiers };
  }

  /** Lit une grille stockée en JSON. Tolère une valeur corrompue. */
  private parseTiers(raw: string): Tier[] {
    try {
      return this.normalizeTiers(JSON.parse(raw));
    } catch {
      this.logger.warn(`Grille de prix illisible, ignorée : ${raw.slice(0, 60)}`);
      return [];
    }
  }

  /**
   * Valide et ordonne une grille.
   * - `min` : entier ≥ 1 ; `price` : nombre ≥ 0, arrondi au centime.
   * - un même `min` ne peut apparaître deux fois (le dernier gagne) ;
   * - tri décroissant sur `min`, comme attendu par tierUnitPrice().
   */
  private normalizeTiers(value: unknown): Tier[] {
    if (!Array.isArray(value)) return [];
    const byMin = new Map<number, number>();

    for (const row of value) {
      if (!row || typeof row !== 'object') continue;
      const min = Math.floor(Number((row as Tier).min));
      const price = Number((row as Tier).price);
      if (!Number.isFinite(min) || min < 1) continue;
      if (!Number.isFinite(price) || price < 0) continue;
      byMin.set(min, Math.round(price * 100) / 100);
    }

    return [...byMin.entries()]
      .map(([min, price]) => ({ min, price }))
      .sort((a, b) => b.min - a.min);
  }
}
