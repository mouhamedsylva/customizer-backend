import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Setting } from '../database/entities/setting.entity';

/**
 * Jeton de possession d'un panier.
 *
 * POURQUOI : les routes /api/cart sont publiques par nécessité (le visiteur du
 * configurateur n'est pas authentifié), et l'identifiant de draft order Shopify
 * est un ENTIER SÉQUENTIEL. Il ne prouve donc rien : un attaquant qui passe une
 * commande obtient son propre id, puis énumère ceux de ses voisins.
 *
 * Sans ce jeton, `GET /api/cart/:id` renvoyait le draft order BRUT — e-mail,
 * téléphone, adresses de livraison et de facturation, montants, et surtout
 * `invoice_url`, un lien de paiement non authentifié. Et `DELETE` permettait de
 * vider le panier de n'importe qui.
 *
 * Le jeton est un HMAC de l'id : impossible à forger sans le secret, et il ne
 * demande aucun stockage — le panier vit côté Shopify, pas chez nous.
 */
@Injectable()
export class CartTokenService implements OnModuleInit {
  private readonly logger = new Logger(CartTokenService.name);

  /** Clé de stockage du secret auto-généré (même table que la session admin). */
  private static readonly SECRET_KEY = 'cart_token_secret';

  private cachedSecret?: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
  ) {}

  /**
   * Résout le secret AU DÉMARRAGE : `sign()` et `verify()` sont synchrones
   * (appelés depuis le service panier) alors que la lecture en base ne l'est pas.
   */
  async onModuleInit(): Promise<void> {
    await this.resolveSecret();
  }

  /**
   * Secret de signature, par ordre de priorité :
   *   1. `CART_TOKEN_SECRET` ;
   *   2. le secret déjà généré et stocké en base ;
   *   3. un nouveau secret aléatoire, persisté pour les prochains démarrages.
   *
   * La persistance est ce qui rend l'auto-génération utilisable : un secret
   * régénéré à chaque boot invaliderait tous les paniers en cours.
   */
  private async resolveSecret(): Promise<string> {
    if (this.cachedSecret) return this.cachedSecret;

    const configured = this.config.get<string>('CART_TOKEN_SECRET');
    if (configured) {
      this.cachedSecret = configured;
      return configured;
    }

    try {
      const row = await this.settings.findOne({
        where: { key: CartTokenService.SECRET_KEY },
      });
      if (row?.value) {
        this.cachedSecret = row.value;
        return row.value;
      }

      const generated = randomBytes(32).toString('hex');
      await this.settings.save(
        this.settings.create({
          key: CartTokenService.SECRET_KEY,
          value: generated,
        }),
      );
      this.cachedSecret = generated;
      return generated;
    } catch (e) {
      // Base indisponible : on ne bloque pas le démarrage. Les paniers ouverts
      // ne survivront pas au redémarrage, mais rien n'est signé avec une valeur
      // prévisible.
      this.cachedSecret = randomBytes(32).toString('hex');
      this.logger.error(
        `Secret de panier non persisté (${(e as Error).message}) : ` +
          'secret éphémère utilisé.',
      );
      return this.cachedSecret;
    }
  }

  /** Jeton de possession d'un panier : HMAC de l'id du draft order. */
  sign(draftOrderId: string | number): string {
    if (!this.cachedSecret) {
      // Ne devrait pas arriver : onModuleInit résout le secret avant que la
      // moindre requête ne soit servie.
      throw new Error('Secret de panier non initialisé.');
    }
    return createHmac('sha256', this.cachedSecret)
      .update(String(draftOrderId))
      .digest('hex');
  }

  /**
   * Le jeton correspond-il bien à ce panier ? Comparaison à temps constant.
   */
  verify(draftOrderId: string | number, token?: string): boolean {
    if (!token || !this.cachedSecret) return false;
    try {
      const expected = Buffer.from(this.sign(draftOrderId));
      const given = Buffer.from(token);
      return (
        expected.length === given.length && timingSafeEqual(expected, given)
      );
    } catch {
      return false;
    }
  }
}
