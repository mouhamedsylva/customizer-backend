import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../database/entities/setting.entity';

/**
 * Clés des produits du configurateur. Elles correspondent aux types utilisés
 * côté frontend (window.CONF_VARIANTS) et servent de clé de réglage.
 */
/* ⚠ NOMMAGE INVERSÉ — vérifié le 2026-08-08, ne pas « corriger ».
 *
 * Les clés `coins` et `patches` ne désignent PAS ce que leur nom suggère. La
 * même inversion existe côté frontend (conf-main-inline.js, commentaire de
 * CONF_VARIANTS) : les deux sont cohérents entre eux.
 *
 *   clé `patches`  → vos PATCHS brodés      → produit « Patch personnalisé »
 *                    écran visible « Coins » du configurateur
 *                    grille : 20 € à 10 pièces … 3,50 € à 100
 *
 *   clé `coins`    → vos COINS métal        → produit « Coin métal personnalisé »
 *                    écran visible « Patchs » du configurateur
 *                    vendus SUR DEVIS : pas de synchronisation Shopify
 *
 * Preuve : la grille `patches` reproduit à l'identique les 5 paliers du PDF
 * « TARIFS PATCHS 2026 » fourni par le commerçant (20 / 12,50 / 9 / 5 / 3,50 €),
 * et `prices.patches = 20 €` correspond à son premier palier.
 *
 * Renommer ces clés casserait la correspondance avec le frontend ET les
 * réglages déjà enregistrés en base (préfixe `KEY_PREFIX + key`).
 */
export const PRODUCT_KEYS = [
  'sweatshirt',
  'tshirt',
  'tshirt_polyester',
  'coins',
  'drapeaux',
  'patches',
  // Supplément par manche personnalisée. Ce n'est pas un article vendu seul
  // mais un add-on : le textile part au panier natif Shopify avec un variant à
  // prix fixe, et une propriété de ligne ne porte pas de prix. Le supplément
  // doit donc être une VRAIE ligne de panier — d'où un produit dédié
  // (handle `personnalisation-manche`, cf. scripts/create-sleeve-addon.mjs).
  'manche',
] as const;

export type ProductKey = (typeof PRODUCT_KEYS)[number];

/** Libellés affichés dans le dashboard.
 *
 *  Ils suivent le PRODUIT RÉEL, pas le nom de la clé — voir l'avertissement sur
 *  PRODUCT_KEYS. L'admin qui saisit un prix sous « Patchs » doit modifier ses
 *  patchs, quelle que soit la clé technique qui les porte. */
export const PRODUCT_LABELS: Record<ProductKey, string> = {
  sweatshirt: 'Sweatshirt',
  tshirt: 'T-shirt coton',
  tshirt_polyester: 'T-shirt polyester',
  coins: 'Coins métal (sur devis)',
  drapeaux: 'Drapeaux',
  patches: 'Patchs',
  manche: 'Personnalisation manche',
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
  /* COINS MÉTAL (clé `coins`) : vendus SUR DEVIS, chiffrés à la main selon la
     finition, la gravure et la quantité. Aucun prix fixe n'a de sens — d'où 0,
     et le blocage par QUOTE_ONLY_KEYS.

     La valeur précédente (2,45 €) faisait afficher un tarif au tiroir du panier
     pour un article qu'aucune commande en ligne n'honore. */
  coins: 0,
  drapeaux: 19.9,
  /* PATCHS (clé `patches`) : 20 € = premier palier de leur grille atelier, à
     10 pièces, qui est le minimum de commande. Toute valeur inférieure
     contredirait la grille — le configurateur annoncerait un prix puis
     facturerait celui du palier atteint. */
  patches: 20,
  /* Prix du variant Shopify `personnalisation-manche` au moment du câblage.
     Cette valeur ne sert que tant que l'admin n'a rien enregistré ; dès le
     premier enregistrement, la base fait foi et pousse le prix vers Shopify. */
  manche: 4,
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
  /* Grille des PATCHS BRODÉS — reprise du PDF « TARIFS PATCHS 2026 » du
     commerçant (5 paliers identiques). Au-delà de 100, le devis prend le relais
     (géré côté UI).

     Clé `patches`, vérifié par mesure le 10/08/2026 : côté frontend,
     `#coins-unit-price` — alimenté par `tierUnitPrice('patches')` — appartient
     au template titré « Patch personnalisé » (min="10"). C'est donc bien cette
     clé qui porte les patchs, malgré l'inversion des LIBELLÉS d'écran.

     Ne pas la déplacer sous `coins` : les articles COIN MÉTAL du panier portent
     `productType = 'coins'`, et `effectiveUnitPrice()` les tarifierait alors
     avec cette grille. Constaté à l'écran : un coin affichait 5,00 €/u à 50
     pièces et 12,50 €/u à 24 — les paliers exacts de cette grille — alors qu'un
     coin se chiffre à la main sur devis. */
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
 *  - les textiles ont 40 variants (un par couleur) : changer le prix doit tous
 *    les mettre à jour, pas un seul ;
 *  - les ids de variants changent quand on régénère les déclinaisons, alors que
 *    l'id du produit reste stable.
 *
 * Ids et nombres de variants RELEVÉS SUR LA BOUTIQUE le 10/08/2026, pas recopiés
 * d'un inventaire : les valeurs précédentes appartenaient à la boutique de
 * développement `customizer-fh5lguwi` et renvoyaient toutes 404 sur `38cca3`,
 * si bien qu'aucun changement de prix du dashboard n'atteignait Shopify.
 *
 * Le `handle` est indiqué en commentaire plutôt qu'un libellé déduit : c'est lui
 * qui tranche l'inversion `coins`/`patches` (voir l'avertissement sur
 * PRODUCT_KEYS). L'ancien commentaire annonçait « Patch personnalisé » en face de
 * `patches`, alors que cette clé désigne le produit `coin-metal-personnalise`.
 */
export const PRODUCT_SHOPIFY_IDS: Partial<Record<ProductKey, string>> = {
  sweatshirt: '15982847033678', //       textile-sweatshirt         (40 variants)
  tshirt: '15982848246094', //           textile-t-shirt-coton      (40 variants)
  tshirt_polyester: '15982849130830', // textile-t-shirt-polyester  (40 variants)
  drapeaux: '15982850572622', //         drapeau-personnalise        (1 variant)
  coins: '15982850801998', //            patch-personnalise          (1 variant)
  manche: '15982845854030', //           personnalisation-manche     (1 variant)
  /* `patches` (= produit `coin-metal-personnalise`, vos COINS MÉTAL) est
     volontairement ABSENT : ces coins se vendent sur devis, leur prix est
     chiffré à la main sur chaque demande. `save()` refuse d'ailleurs
     d'enregistrer un prix pour cette clé. Son id figure dans
     CONFIGURATOR_PRODUCT_IDS ci-dessous. */
};

/**
 * TOUS les produits Shopify du configurateur — les 7, contrairement à
 * PRODUCT_SHOPIFY_IDS qui n'en liste que 6.
 *
 * Deux tables et non une : elles répondent à deux questions différentes.
 * PRODUCT_SHOPIFY_IDS sert à POUSSER un prix vers Shopify, et exclut donc les
 * coins métal (vendus sur devis, sans prix fixe). Celle-ci sert à RECONNAÎTRE
 * une commande venant du configurateur — un coin commandé en fait évidemment
 * partie.
 *
 * Sert à marquer `Order.fromConfigurator` : le dashboard de l'atelier ne doit
 * afficher que ce qu'il a à floquer, pas les 300 ventes courantes de la
 * boutique (chaussettes, jeux…).
 *
 * Ids relevés sur la boutique le 10/08/2026.
 */
export const CONFIGURATOR_PRODUCT_IDS: readonly string[] = [
  '15982847033678', // textile-sweatshirt
  '15982848246094', // textile-t-shirt-coton
  '15982849130830', // textile-t-shirt-polyester
  '15982850572622', // drapeau-personnalise
  '15982850801998', // patch-personnalise      (clé `coins`)
  '15982850998606', // coin-metal-personnalise (clé `patches`, sur devis)
  '15982845854030', // personnalisation-manche
];

/**
 * Titres des mêmes produits, pour les commandes DÉJÀ en base.
 *
 * Jusqu'au 11/08/2026, `saveOrder()` ne conservait pas `product_id` par ligne
 * (ni de SKU : les 7 produits n'en ont aucun — vérifié). Le titre est donc le
 * seul point d'accroche sur l'historique.
 *
 * Repli et non critère principal : un titre se renomme dans l'admin Shopify,
 * un id non. Toute commande reçue après cette date est reconnue par son
 * `product_id`.
 */
export const CONFIGURATOR_PRODUCT_TITLES: readonly string[] = [
  'Textile - Sweatshirt',
  'Textile - T-shirt Coton',
  'Textile - T-shirt Polyester',
  'Drapeau personnalisé',
  'Patch personnalisé',
  'Coin métal personnalisé',
  'Personnalisation manche',
];

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
 * Produits vendus UNIQUEMENT sur devis : aucun tarif n'est enregistrable.
 *
 * Les COINS MÉTAL sont chiffrés à la main sur chaque demande (finition,
 * gravure, quantité). Un prix enregistré s'afficherait dans le configurateur
 * sans qu'aucune commande ne puisse l'honorer.
 *
 * La règle est une CONSTANTE, et non un test répété : `save()` excluait les
 * coins mais pas `saveTiers()`, si bien que le prix de base était rejeté
 * pendant que la grille dégressive, elle, était écrite. Le configurateur
 * servait alors un prix par défaut contredit par sa propre grille — et comme
 * la ligne existait en base, l'état ne se réparait jamais tout seul.
 *
 * Le dashboard lit cette liste pour masquer les champs correspondants
 * (cf. `quoteOnly` dans GET /api/admin/pricing) : l'interface ne propose donc
 * plus une saisie que le serveur rejette en silence.
 */
/* `patches` et non `coins` : à cause de l'inversion des noms côté frontend
   (voir l'avertissement sur PRODUCT_KEYS), la clé `patches` désigne vos COINS
   MÉTAL — produit `coin-metal-personnalise`, vérifié sur la boutique.

   Ce sont eux qui se vendent sur devis. La clé `coins`, elle, porte vos PATCHS
   (`patch-personnalise`) : ils partent au panier natif avec le variant
   60327529939278, leur prix DOIT donc rester enregistrable.

   La valeur précédente (`['coins']`) bloquait l'inverse : le dashboard refusait
   le prix des patchs vendus au panier, et acceptait celui des coins qu'aucune
   commande en ligne n'honore.

   À savoir sur le parcours : les coins PEUVENT être ajoutés au panier du
   configurateur, mais `variantForItem()` ne leur associe aucun variant — ils
   sont retirés au checkout et orientés vers une demande de devis
   (recapitulatif.liquid, garde-fous sur `skipped`). Le prix reste donc chiffré
   à la main sur chaque demande. */
export const QUOTE_ONLY_KEYS: ProductKey[] = ['coins'];

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
      /* Un produit SUR DEVIS vaut 0, quoi que dise la base.

         `save()` refuse d'écrire ces clés, mais des lignes antérieures à cette
         règle subsistent : `price_coins = 2.45`, héritée de la boutique de
         développement, était encore servie au configurateur — qui affichait donc
         2,45 € l'unité pour un coin métal chiffré à la main sur devis. Et comme
         l'écriture est bloquée, la ligne ne pouvait plus être corrigée depuis le
         dashboard : elle se serait propagée indéfiniment.
         Ignorer la base ici est plus sûr que de la nettoyer par migration — le
         résultat ne dépend plus de l'état des données. */
      if (QUOTE_ONLY_KEYS.includes(key)) {
        out[key] = 0;
        continue;
      }
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
      // Vendu sur devis : aucun prix ne doit être enregistré (cf.
      // QUOTE_ONLY_KEYS). Le filtre est au plus près de l'écriture — le poser
      // dans le contrôleur laisserait passer tout autre appelant de `save()`.
      if (QUOTE_ONLY_KEYS.includes(key)) continue;
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
      /* Un produit SUR DEVIS n'a JAMAIS de grille dégressive : son prix dépend
         de la finition et de la gravure, pas seulement de la quantité. Même
         garde que dans get() — `saveTiers()` refuse ces clés, mais une ligne
         antérieure à la règle resterait servie au configurateur, qui
         tarifierait alors un article censé passer par un devis. */
      if (QUOTE_ONLY_KEYS.includes(key)) {
        out[key] = [];
        continue;
      }
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
      // Même exclusion que `save()` : sans elle, la grille d'un produit sur
      // devis s'enregistrait alors que son prix de base était rejeté.
      if (QUOTE_ONLY_KEYS.includes(key)) continue;
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
