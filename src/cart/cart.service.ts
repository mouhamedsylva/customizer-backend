import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  ShopifyLineItem,
  ShopifyService,
} from '../shared/shopify.service';
import { throwUpstream } from '../shared/upstream-error';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { CartTokenService } from './cart-token.service';

/** Ligne de panier telle qu'exposée au client (jamais l'objet Shopify brut). */
export interface PublicCartLine {
  id: string | number;
  title: string;
  variantTitle?: string | null;
  quantity: number;
  price: string;
  properties?: Array<{ name: string; value: string }>;
}

/** Panier tel qu'exposé au client. */
export interface PublicCart {
  draftOrderId: string;
  /** À conserver côté client : exigé pour relire ou modifier ce panier. */
  cartToken: string;
  lineItems: PublicCartLine[];
  subtotalPrice: string | null;
  totalPrice: string | null;
  currency: string | null;
}

/**
 * Service panier : le panier est materialise par un draft order Shopify.
 * Le panier AJAX Shopify (/cart/add.js) etant cote navigateur, on passe ici
 * par l'API Admin (draft orders) pour manipuler le panier cote serveur.
 *
 * SÉCURITÉ : ces routes sont publiques (le visiteur du configurateur n'est pas
 * authentifié), et l'id de draft order Shopify est un entier SÉQUENTIEL, donc
 * énumérable. Deux garde-fous en découlent :
 *
 *  1. la réponse est PROJETÉE (`toPublicCart`) — le draft order brut contient
 *     e-mail, téléphone, adresses, et `invoice_url` (un lien de paiement non
 *     authentifié) ;
 *  2. toute lecture ou modification d'un panier EXISTANT exige un `cartToken`
 *     signé, remis à la création.
 */
@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly shopify: ShopifyService,
    private readonly tokens: CartTokenService,
  ) {}

  /** Transforme un objet properties {cle: valeur} en tableau attendu par Shopify. */
  private toShopifyProperties(
    props?: Record<string, string>,
  ): Array<{ name: string; value: string }> | undefined {
    if (!props) return undefined;
    return Object.entries(props).map(([name, value]) => ({
      name,
      value: String(value),
    }));
  }

  /**
   * Projette un draft order Shopify en panier public.
   *
   * On ÉNUMÈRE les champs exposés plutôt que d'en retirer quelques-uns : une
   * liste d'exclusion laisserait passer tout nouveau champ ajouté par Shopify.
   */
  private toPublicCart(draft: Record<string, any>): PublicCart {
    // Sans cette garde, `String(undefined)` valait la chaîne « undefined », et
    // le jeton signait cette chaîne : tous les paniers cassés partageaient donc
    // le MÊME jeton, valide pour l'id littéral « undefined ». Le contrôle de
    // possession était contourné pour ce cas.
    if (draft?.id === undefined || draft?.id === null || draft.id === '') {
      throw new Error('Réponse Shopify inattendue : panier sans identifiant.');
    }
    const id = String(draft.id);
    const items = Array.isArray(draft.line_items) ? draft.line_items : [];
    return {
      draftOrderId: id,
      cartToken: this.tokens.sign(id),
      lineItems: items.map((li: Record<string, any>) => ({
        id: li.id,
        title: li.title,
        variantTitle: li.variant_title ?? null,
        quantity: li.quantity,
        price: li.price,
        properties: Array.isArray(li.properties) ? li.properties : undefined,
      })),
      subtotalPrice: draft.subtotal_price ?? null,
      totalPrice: draft.total_price ?? null,
      currency: draft.currency ?? null,
    };
  }

  /**
   * Vérifie que l'appelant possède bien ce panier.
   *
   * On répond 403 sans distinguer « panier inexistant » de « jeton invalide » :
   * la réponse ne doit pas servir d'oracle pour savoir quels ids existent.
   */
  private assertOwnership(draftOrderId: string | number, token?: string): void {
    if (!this.tokens.verify(draftOrderId, token)) {
      throw new ForbiddenException('Accès à ce panier refusé.');
    }
  }

  /**
   * Ajoute une ligne au panier.
   * Sans draftOrderId : cree un nouveau panier (et son jeton).
   * Avec draftOrderId : exige le `cartToken` correspondant.
   */
  async add(dto: AddToCartDto): Promise<PublicCart> {
    const newLine: ShopifyLineItem = {
      variant_id: dto.variantId,
      quantity: dto.quantity,
      properties: this.toShopifyProperties(dto.properties),
    };

    // Contrôle AVANT tout appel Shopify : inutile de solliciter la boutique
    // pour une requête qu'on va refuser.
    if (dto.draftOrderId) {
      this.assertOwnership(dto.draftOrderId, dto.cartToken);
    }

    try {
      if (!dto.draftOrderId) {
        const created = await this.shopify.createDraftOrder({
          line_items: [newLine],
        });
        return this.toPublicCart(created);
      }

      // On recupere le panier existant, on concatene la nouvelle ligne, on met a jour.
      const draft = await this.shopify.getDraftOrder(dto.draftOrderId);
      const existing: ShopifyLineItem[] = (draft.line_items || []).map(
        (li: Record<string, any>) => this.rebuildLine(li),
      );
      const updated = await this.shopify.updateDraftOrderLineItems(
        dto.draftOrderId,
        [...existing, newLine],
      );
      return this.toPublicCart(updated);
    } catch (error) {
      throwUpstream(this.logger, "Impossible d'ajouter au panier.", error);
    }
  }

  /**
   * Reconstruit une ligne existante pour la renvoyer à Shopify.
   *
   * `applied_discount` est PRÉSERVÉ dans tous les cas : l'omettre faisait
   * disparaître une remise commerciale dès qu'on touchait au panier — le client
   * voyait son total augmenter en retirant un article.
   *
   * `taxable` et `requires_shipping` ne sont renvoyés que sur les lignes
   * `custom`. Sur une ligne rattachée à un variant, ces attributs appartiennent
   * au produit : Shopify les dérive lui-même et peut REFUSER qu'on les impose.
   * Un rejet ici casserait toute modification de panier (502), alors que le
   * gain serait nul — la valeur renvoyée serait de toute façon celle du
   * variant. `price`, lui, est un override que Shopify accepte, on le garde
   * pour ne pas re-tarifer un panier en silence si l'admin change un prix.
   */
  private rebuildLine(li: Record<string, any>): ShopifyLineItem {
    const common = {
      quantity: li.quantity as number,
      properties: li.properties as Array<{ name: string; value: string }>,
      ...(li.applied_discount ? { applied_discount: li.applied_discount } : {}),
    };

    if (li.variant_id) {
      return {
        variant_id: li.variant_id as number | string,
        price: li.price,
        ...common,
      };
    }

    return {
      title: li.title as string,
      price: li.price,
      custom: true,
      ...common,
      ...(li.taxable !== undefined ? { taxable: li.taxable } : {}),
      ...(li.requires_shipping !== undefined
        ? { requires_shipping: li.requires_shipping }
        : {}),
    };
  }

  /** Recupere le contenu d'un panier (projeté, jamais le draft order brut). */
  async get(draftOrderId: string, token?: string): Promise<PublicCart> {
    this.assertOwnership(draftOrderId, token);
    try {
      const draft = await this.shopify.getDraftOrder(draftOrderId);
      return this.toPublicCart(draft);
    } catch (error) {
      this.throwCartError(error);
    }
  }

  /**
   * Traduit une erreur Shopify en réponse HTTP honnête.
   *
   * On ne renvoie 404 que si Shopify dit vraiment « introuvable ». Traduire
   * TOUTE erreur en 404 laissait croire au thème que le panier avait disparu :
   * il vidait alors son état local alors qu'un simple timeout ou un 429 de
   * quota était en cause, et que le panier était intact.
   */
  private throwCartError(error: unknown): never {
    const detail = error instanceof Error ? error.message : String(error);
    const notFound = /\(404\)/.test(detail);
    throwUpstream(
      this.logger,
      notFound ? 'Panier introuvable.' : 'Panier momentanément indisponible.',
      error,
      notFound ? HttpStatus.NOT_FOUND : HttpStatus.BAD_GATEWAY,
    );
  }

  /** Retire une ligne d'un panier. */
  async removeItem(
    draftOrderId: string,
    lineId: string,
    token?: string,
  ): Promise<PublicCart> {
    this.assertOwnership(draftOrderId, token);
    try {
      const updated = await this.shopify.deleteDraftOrderLine(
        draftOrderId,
        lineId,
      );
      return this.toPublicCart(updated);
    } catch (error) {
      // Même discrimination que `get()` : un panier disparu renvoie 404, une
      // panne Shopify 502. Sans cela, la même cause produisait deux codes
      // différents selon la route appelée.
      this.throwCartError(error);
    }
  }
}
