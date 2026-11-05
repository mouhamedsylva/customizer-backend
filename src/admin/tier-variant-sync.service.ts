import { Injectable, Logger } from '@nestjs/common';
import { ShopifyService, StructureProduit } from '../shared/shopify.service';
import {
  PricingService,
  PRODUCT_SHOPIFY_IDS,
  ProductKey,
  Tier,
  TIER_PRODUCT_KEYS,
} from './pricing.service';

/**
 * PRIX DÉGRESSIFS FACTURÉS PAR VARIANT « PALIER ».
 *
 * Le panier natif Shopify facture le prix du variant. Chaque palier de la
 * grille dégressive devient donc un VARIANT du produit (option « Palier »,
 * valeur « Dès N pièces »), à son propre prix. Le récapitulatif du thème
 * choisit couleur + palier selon la quantité totale du produit, et Shopify
 * facture directement le bon montant.
 *
 * Remplace les remises automatiques (04/11/2026) : la boutique (forfait
 * Basic) n'en autorise que 25 actives, et le commerçant en a besoin pour ses
 * propres promos. Ici, aucune remise n'est utilisée — celles créées par
 * l'ancienne version (« Tarif dégressif — … ») sont supprimées à la fin de
 * chaque passe, sinon elles s'ajouteraient au prix du palier.
 *
 * Tourne à chaque enregistrement du panneau « Prix » : le dashboard reste
 * l'unique source de la grille.
 */

export const OPTION_PALIER = 'Palier';

/** Préfixe des anciennes remises automatiques, à purger. */
export const ANCIEN_PREFIXE_REMISE = 'Tarif dégressif — ';

/** Libellé STABLE d'un palier : ne dépend que de son seuil. */
export function libellePalier(min: number): string {
  return min <= 1 ? 'Dès 1 pièce' : `Dès ${min} pièces`;
}

/** Seuil lu dans un libellé (« Dès 20 pièces » → 20), null si illisible. */
export function seuilDuLibelle(libelle: string | undefined): number | null {
  const m = String(libelle || '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

export interface PlanPaliers {
  /** Grille sans palier valide : le produit n'est pas touché. */
  grilleVide: boolean;
  /** Valeur à donner aux variants existants si l'option n'existe pas encore. */
  creerOption: string | null;
  creer: Array<{ options: Record<string, string>; price: number; mediaId: string | null }>;
  modifierPrix: Array<{ id: string; price: number }>;
  supprimer: string[];
  avertissements: string[];
}

/**
 * Compare la structure du produit à la grille (fonction pure, testée).
 *
 * - Si l'option « Palier » n'existe pas : le plan se limite à la créer
 *   (les variants existants deviennent ceux du PLUS PETIT palier,
 *   LEAVE_AS_IS) ; l'appelant relit alors le produit et replanifie.
 * - Les variants sont groupés par leurs AUTRES options (la couleur ; aucune
 *   pour le patch) : chaque groupe doit avoir un variant par palier.
 * - On crée avant de supprimer : un variant ne disparaît que si son palier
 *   n'est plus dans la grille.
 */
export function planifierPaliers(produit: StructureProduit, grille: Tier[]): PlanPaliers {
  const plan: PlanPaliers = {
    grilleVide: false, creerOption: null, creer: [], modifierPrix: [], supprimer: [], avertissements: [],
  };
  const paliers = grille
    .filter((t) => t && t.min >= 1 && t.price > 0)
    .slice()
    .sort((a, b) => a.min - b.min);
  if (!paliers.length) {
    plan.grilleVide = true;
    plan.avertissements.push(`« ${produit.title} » : grille vide, produit laissé tel quel.`);
    return plan;
  }

  const aPalier = produit.optionNames.includes(OPTION_PALIER);
  if (!aPalier) {
    // L'option est créée d'abord, puis le produit est RELU et replanifié
    // (Shopify peut remplacer l'option « Title » du variant par défaut).
    plan.creerOption = libellePalier(paliers[0].min);
    return plan;
  }
  const autres = produit.optionNames.filter((n) => n !== OPTION_PALIER);

  /* Groupe = toutes les options SAUF « Palier » (la couleur pour un textile,
     rien pour le patch). Un nouveau variant reprend les valeurs du groupe. */
  const vus = produit.variants.map((v) => ({
    ...v,
    palier: v.options[OPTION_PALIER],
    couleur: JSON.stringify(autres.map((n) => v.options[n] ?? '')),
  }));

  const couleurs = [...new Set(vus.map((v) => v.couleur))];
  const libellesVoulus = new Set(paliers.map((t) => libellePalier(t.min)));

  for (const couleur of couleurs) {
    const deCetteCouleur = vus.filter((v) => v.couleur === couleur);
    const media = deCetteCouleur.find((v) => v.mediaId)?.mediaId || null;
    for (const t of paliers) {
      const lib = libellePalier(t.min);
      const v = deCetteCouleur.find((x) => x.palier === lib);
      if (!v) {
        const valeurs: string[] = JSON.parse(couleur);
        const options: Record<string, string> = {};
        autres.forEach((n, i) => { options[n] = valeurs[i]; });
        options[OPTION_PALIER] = lib;
        plan.creer.push({ options, price: t.price, mediaId: media });
      } else if (Math.abs(v.price - t.price) >= 0.005) {
        plan.modifierPrix.push({ id: v.id, price: t.price });
      }
    }
  }

  for (const v of vus) {
    if (libellesVoulus.has(v.palier)) continue;
    if (seuilDuLibelle(v.palier) == null) {
      plan.avertissements.push(
        `« ${produit.title} » : variant au palier illisible (« ${v.palier} ») conservé.`,
      );
      continue;
    }
    plan.supprimer.push(v.id);
  }
  return plan;
}

export interface ResultatSynchroPaliers {
  ok: boolean;
  variantsCrees: number;
  prixModifies: number;
  variantsSupprimes: number;
  remisesSupprimees: number;
  avertissements: string[];
}

@Injectable()
export class TierVariantSyncService {
  private readonly logger = new Logger(TierVariantSyncService.name);
  /** Deux enregistrements rapprochés ne doivent pas créer de doublons. */
  private enCours: Promise<ResultatSynchroPaliers> | null = null;

  constructor(
    private readonly pricing: PricingService,
    private readonly shopify: ShopifyService,
  ) {}

  synchroniser(): Promise<ResultatSynchroPaliers> {
    const precedent = this.enCours || Promise.resolve(null);
    const courant = precedent.catch(() => null).then(() => this.executer());
    this.enCours = courant;
    return courant;
  }

  private async executer(): Promise<ResultatSynchroPaliers> {
    const res: ResultatSynchroPaliers = {
      ok: true, variantsCrees: 0, prixModifies: 0, variantsSupprimes: 0,
      remisesSupprimees: 0, avertissements: [],
    };
    const tiers = await this.pricing.getTiers();
    const reussis: string[] = [];

    for (const key of TIER_PRODUCT_KEYS) {
      const productId = PRODUCT_SHOPIFY_IDS[key];
      if (!productId) continue;
      try {
        if (await this.synchroniserProduit(key, productId, tiers[key] || [], res)) {
          reussis.push(productId);
        }
      } catch (e) {
        res.avertissements.push(`Paliers ${key} : ${(e as Error).message}`);
      }
    }

    await this.purgerAnciennesRemises(reussis, res);

    if (res.avertissements.length) res.ok = false;
    this.logger.log(
      `Paliers : ${res.variantsCrees} variant(s) créé(s), ${res.prixModifies} prix modifié(s), ` +
        `${res.variantsSupprimes} supprimé(s), ${res.remisesSupprimees} ancienne(s) remise(s) supprimée(s).`,
    );
    return res;
  }

  private async synchroniserProduit(
    key: ProductKey,
    productId: string,
    grille: Tier[],
    res: ResultatSynchroPaliers,
  ): Promise<boolean> {
    let lu = await this.shopify.getProductStructure(productId);
    if (!lu.ok || !lu.product) {
      res.avertissements.push(`Paliers ${key} : ${lu.error || 'produit illisible'}.`);
      return false;
    }
    let plan = planifierPaliers(lu.product, grille);

    if (plan.creerOption) {
      const r = await this.shopify.createProductOption(lu.product.id, OPTION_PALIER, plan.creerOption);
      if (!r.ok) {
        // Sans l'option, créer des variants « Palier » échouerait : on s'arrête là.
        res.avertissements.push(`Paliers « ${lu.product.title} » : option non créée (${r.error}).`);
        return false;
      }
      lu = await this.shopify.getProductStructure(productId);
      if (!lu.ok || !lu.product) {
        res.avertissements.push(`Paliers ${key} : relecture impossible (${lu.error}).`);
        return false;
      }
      plan = planifierPaliers(lu.product, grille);
    }
    const produit = lu.product;
    res.avertissements.push(...plan.avertissements);
    if (plan.grilleVide) return false;
    if (plan.creer.length) {
      const r = await this.shopify.bulkCreateVariants(produit.id, plan.creer);
      res.variantsCrees += r.created;
      if (!r.ok) {
        res.avertissements.push(`Paliers « ${produit.title} » : création (${r.error}).`);
        return false; // ne rien supprimer si la création a échoué
      }
    }
    if (plan.modifierPrix.length) {
      const r = await this.shopify.bulkUpdateVariantPrices(produit.id, plan.modifierPrix);
      if (r.ok) res.prixModifies += plan.modifierPrix.length;
      else {
        res.avertissements.push(`Paliers « ${produit.title} » : prix (${r.error}).`);
        return false;
      }
    }
    if (plan.supprimer.length) {
      const r = await this.shopify.bulkDeleteVariants(produit.id, plan.supprimer);
      if (r.ok) res.variantsSupprimes += plan.supprimer.length;
      else res.avertissements.push(`Paliers « ${produit.title} » : suppression (${r.error}).`);
    }
    return true;
  }

  /**
   * Supprime les remises « Tarif dégressif — … » de l'ancienne méthode, mais
   * SEULEMENT pour les produits dont les paliers sont en place : sinon le
   * produit perdrait sa remise sans avoir encore ses variants.
   */
  private async purgerAnciennesRemises(
    reussis: string[],
    res: ResultatSynchroPaliers,
  ): Promise<void> {
    const liste = await this.shopify.listAutomaticDiscounts();
    if (!liste.ok || !liste.discounts) {
      res.avertissements.push(
        `Anciennes remises dégressives non vérifiées : ${liste.error || 'lecture impossible'}.`,
      );
      return;
    }
    const aPurger = liste.discounts.filter(
      (x) =>
        x.title.startsWith(ANCIEN_PREFIXE_REMISE) &&
        x.productIds.length > 0 &&
        x.productIds.every((p) => reussis.includes(p)),
    );
    for (const d of aPurger) {
      const r = await this.shopify.deleteAutomaticDiscount(d.id);
      if (r.ok) res.remisesSupprimees++;
      else res.avertissements.push(`Suppression « ${d.title} » : ${r.error}`);
    }
  }
}
