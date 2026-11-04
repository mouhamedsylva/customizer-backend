import { Injectable, Logger } from '@nestjs/common';
import {
  AutomaticDiscount,
  ShopifyService,
  TierDiscountSpec,
} from '../shared/shopify.service';
import {
  PricingService,
  PRODUCT_SHOPIFY_IDS,
  ProductKey,
  TIER_PRODUCT_KEYS,
  Tiers,
} from './pricing.service';

/**
 * PRIX DÉGRESSIFS FACTURÉS AU PAIEMENT.
 *
 * Le configurateur affiche les grilles dégressives, mais le panier natif
 * Shopify facture le prix FIXE du variant : sans remise, un client voyait
 * 265 € pour 10 t-shirts et en payait 320 € (mesuré le 04/11/2026).
 *
 * Ce service traduit chaque palier en une REMISE AUTOMATIQUE Shopify
 * « montant fixe par article », ciblée sur le produit et conditionnée à une
 * quantité minimale. Il tourne à chaque enregistrement du panneau « Prix » :
 * le dashboard reste l'unique source, rien n'est à retoucher dans Shopify.
 *
 * Il ne touche QUE les remises dont le titre commence par TITLE_PREFIX : une
 * remise créée à la main par le commerçant n'est jamais modifiée.
 */

/** Préfixe des remises gérées ici. Visible du client au paiement. */
export const TITLE_PREFIX = 'Tarif dégressif — ';

/** Shopify limite le nombre de remises automatiques ACTIVES simultanées. */
export const SHOPIFY_MAX_AUTOMATIC = 25;

/** Noms affichés au client dans le titre de la remise. */
const NOMS: Partial<Record<ProductKey, string>> = {
  sweatshirt: 'Sweatshirt',
  tshirt: 'T-shirt coton',
  tshirt_polyester: 'T-shirt polyester',
  patches: 'Patch',
  drapeaux: 'Drapeau',
};

export interface RemisePalier extends TierDiscountSpec {
  key: ProductKey;
}

/**
 * Remises voulues, d'après les grilles et le prix réel des variants.
 *
 * - montant = prix du variant − prix du palier, au centime ;
 * - un palier dont le prix n'est pas INFÉRIEUR au prix du variant ne donne
 *   pas de remise (c'est le prix de base, ex. `min: 1`) ;
 * - un palier `min ≤ 1` ne donne pas de remise : il s'appliquerait à tout.
 */
export function calculerRemises(
  tiers: Tiers,
  prixVariants: Partial<Record<ProductKey, number>>,
): RemisePalier[] {
  const out: RemisePalier[] = [];
  for (const key of TIER_PRODUCT_KEYS) {
    const base = prixVariants[key];
    const productId = PRODUCT_SHOPIFY_IDS[key];
    if (base == null || !productId) continue;
    for (const t of tiers[key] || []) {
      if (!(t.min > 1)) continue;
      const amount = Math.round((base - t.price) * 100) / 100;
      if (!(amount > 0)) continue;
      out.push({
        key,
        productId,
        min: t.min,
        amount,
        title: `${TITLE_PREFIX}${NOMS[key] || key} (${t.min}+)`,
      });
    }
  }
  return out;
}

export interface PlanSynchro {
  creer: RemisePalier[];
  modifier: Array<{ id: string; remise: RemisePalier }>;
  supprimer: AutomaticDiscount[];
  inchangees: number;
}

/**
 * Compare le voulu à l'existant (fonction pure, testée).
 *
 * @param produitsIgnores ids des produits dont le prix n'a pas pu être lu :
 *        leurs remises existantes sont CONSERVÉES telles quelles — mieux vaut
 *        une remise d'hier qu'un client qui perd sa remise sur une erreur
 *        réseau.
 */
export function planifier(
  voulues: RemisePalier[],
  existantes: AutomaticDiscount[],
  produitsIgnores: string[] = [],
): PlanSynchro {
  const nos = existantes.filter((d) => d.title.startsWith(TITLE_PREFIX));
  const plan: PlanSynchro = { creer: [], modifier: [], supprimer: [], inchangees: 0 };
  const utilisees = new Set<string>();

  for (const r of voulues) {
    const memes = nos.filter((d) => d.title === r.title);
    const d = memes[0];
    if (!d) {
      plan.creer.push(r);
      continue;
    }
    utilisees.add(d.id);
    // Doublons de titre (deux synchros concurrentes, copie manuelle…).
    for (const x of memes.slice(1)) plan.supprimer.push(x);

    const bonProduit = d.productIds.length === 1 && d.productIds[0] === r.productId;
    if (d.type !== 'DiscountAutomaticBasic' || !bonProduit) {
      // Type ou produit faux : la mise à jour ne change pas le produit
      // ciblé. On remplace la remise.
      plan.supprimer.push(d);
      plan.creer.push(r);
      continue;
    }
    const aJour =
      d.status === 'ACTIVE' &&
      d.minQuantity === r.min &&
      d.amount != null &&
      Math.abs(d.amount - r.amount) < 0.005 &&
      d.appliesOnEachItem === true;
    if (aJour) {
      plan.inchangees++;
    } else {
      plan.modifier.push({ id: d.id, remise: r });
    }
  }

  for (const d of nos) {
    if (utilisees.has(d.id) || plan.supprimer.some((x) => x.id === d.id)) continue;
    if (d.productIds.some((p) => produitsIgnores.includes(p))) continue;
    plan.supprimer.push(d);
  }
  return plan;
}

export interface ResultatSynchro {
  ok: boolean;
  creees: number;
  modifiees: number;
  supprimees: number;
  inchangees: number;
  avertissements: string[];
}

@Injectable()
export class DiscountSyncService {
  private readonly logger = new Logger(DiscountSyncService.name);
  /** Deux enregistrements rapprochés ne doivent pas créer de doublons. */
  private enCours: Promise<ResultatSynchro> | null = null;

  constructor(
    private readonly pricing: PricingService,
    private readonly shopify: ShopifyService,
  ) {}

  synchroniser(): Promise<ResultatSynchro> {
    const precedent = this.enCours || Promise.resolve(null);
    const courant = precedent
      .catch(() => null)
      .then(() => this.executer());
    this.enCours = courant;
    return courant;
  }

  private async executer(): Promise<ResultatSynchro> {
    const res: ResultatSynchro = {
      ok: true, creees: 0, modifiees: 0, supprimees: 0, inchangees: 0, avertissements: [],
    };

    // 1) Prix réel de chaque produit dégressif.
    const prix: Partial<Record<ProductKey, number>> = {};
    const ignores: string[] = [];
    for (const key of TIER_PRODUCT_KEYS) {
      const id = PRODUCT_SHOPIFY_IDS[key];
      if (!id) continue;
      const r = await this.shopify.getProductPrice(id);
      if (r.ok && r.price != null) {
        prix[key] = r.price;
      } else {
        ignores.push(id);
        res.avertissements.push(
          `Remises dégressives ${NOMS[key] || key} non mises à jour : ${r.error || 'prix illisible'}.`,
        );
      }
    }

    // 2) Existant.
    const liste = await this.shopify.listAutomaticDiscounts();
    if (!liste.ok || !liste.discounts) {
      res.ok = false;
      res.avertissements.push(
        `Remises dégressives non synchronisées : ${liste.error || 'lecture impossible'} ` +
          `(l'app a-t-elle les permissions read_discounts / write_discounts ?).`,
      );
      return res;
    }

    // 3) Plan puis application.
    const voulues = calculerRemises(await this.pricing.getTiers(), prix);
    const plan = planifier(voulues, liste.discounts, ignores);
    res.inchangees = plan.inchangees;

    for (const d of plan.supprimer) {
      const r = await this.shopify.deleteAutomaticDiscount(d.id);
      if (r.ok) res.supprimees++;
      else res.avertissements.push(`Suppression « ${d.title} » : ${r.error}`);
    }
    for (const { id, remise } of plan.modifier) {
      const r = await this.shopify.updateTierDiscount(id, remise);
      if (r.ok) res.modifiees++;
      else res.avertissements.push(`Mise à jour « ${remise.title} » : ${r.error}`);
    }
    for (const remise of plan.creer) {
      const r = await this.shopify.createTierDiscount(remise);
      if (r.ok) res.creees++;
      else res.avertissements.push(`Création « ${remise.title} » : ${r.error}`);
    }

    // 4) Plafond Shopify des remises automatiques actives.
    const autresActives = liste.discounts.filter(
      (d) => d.status === 'ACTIVE' && !d.title.startsWith(TITLE_PREFIX),
    ).length;
    if (autresActives + voulues.length > SHOPIFY_MAX_AUTOMATIC) {
      res.avertissements.push(
        `${autresActives + voulues.length} remises automatiques actives pour un maximum Shopify de ` +
          `${SHOPIFY_MAX_AUTOMATIC} : certaines remises dégressives peuvent être refusées. ` +
          `Réduisez le nombre de paliers ou de remises automatiques.`,
      );
    }

    if (res.avertissements.length) res.ok = false;
    this.logger.log(
      `Remises dégressives : ${res.creees} créée(s), ${res.modifiees} modifiée(s), ` +
        `${res.supprimees} supprimée(s), ${res.inchangees} inchangée(s).`,
    );
    return res;
  }
}
