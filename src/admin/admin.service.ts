import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Order } from '../database/entities/order.entity';
import { Quote } from '../database/entities/quote.entity';
import { Design } from '../database/entities/design.entity';

/** Critères de filtrage / tri des commandes. */
export interface OrderQuery {
  period?: string;      // all | 7d | 30d | month | quarter | year
  payment?: string;     // all | paid | pending | refunded…
  production?: string;  // all | to_produce | producing | ready | shipped
  sort?: string;        // date_desc | date_asc | amount_desc | amount_asc
  limit?: number;
}

/**
 * Date de début d'une période (null = pas de filtre).
 *
 * TOUT est ancré en UTC, délibérément.
 *
 * Les dates de commande sont stockées en colonne `datetime` MySQL, un type SANS
 * fuseau : la valeur écrite est celle qu'on relit, telle quelle. Les bornes
 * doivent donc être calculées dans le même référentiel, sinon le filtre décale.
 *
 * Les bornes calendaires (mois, trimestre, année) utilisaient `getFullYear()` /
 * `getMonth()` et le constructeur `Date`, qui lisent et écrivent en heure
 * LOCALE. Tant que le serveur tourne en UTC, local et UTC coïncident et rien ne
 * se voit. Le jour où quelqu'un pose `TZ=Europe/Paris` sur le conteneur — un
 * geste anodin — la borne du 1er août devient le 31 juillet à 22 h UTC : une
 * commande passée le 31 juillet à 23 h apparaîtrait alors dans l'export
 * comptable de juillet ET dans celui d'août, comptée deux fois.
 *
 * Les fenêtres glissantes (7d, 30d) étaient déjà correctes : un décalage à
 * partir de `now` ne dépend d'aucun fuseau.
 */
export function periodStart(period?: string): Date | null {
  const now = new Date();
  switch (period) {
    case '7d':
      return new Date(now.getTime() - 7 * 86400000);
    case '30d':
      return new Date(now.getTime() - 30 * 86400000);
    case 'month':
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
      );
    case 'quarter': {
      const q = Math.floor(now.getUTCMonth() / 3) * 3;
      return new Date(Date.UTC(now.getUTCFullYear(), q, 1, 0, 0, 0, 0));
    }
    case 'year':
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    default:
      return null; // 'all' ou non précisé
  }
}

/**
 * Plafonds des listes servies au dashboard.
 *
 * Nommés plutôt que répétés en dur : `getStatus()` doit appliquer EXACTEMENT
 * les mêmes bornes, sinon le compteur et la liste divergent en permanence et
 * la bannière « nouvelles données » ne s'éteint plus jamais.
 */
export const ORDERS_LIMIT = 300;
export const QUOTES_LIMIT = 500;

/**
 * Accès aux données pour le dashboard admin.
 *
 * Note MySQL : trier (ORDER BY) des lignes qui contiennent de grosses colonnes
 * JSON peut déclencher « Out of sort memory ». Pour l'éviter, on récupère
 * d'abord les IDs triés (colonnes légères indexées), puis on charge les lignes
 * complètes et on les ré-ordonne côté application.
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Quote) private readonly quotes: Repository<Quote>,
    @InjectRepository(Design) private readonly designs: Repository<Design>,
  ) {}

  /**
   * Commandes, avec filtres et tri.
   * @param period  'all' | '7d' | '30d' | 'month' | 'quarter' | 'year'
   * @param sort    'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'
   */
  async getOrders(opts: OrderQuery = {}): Promise<Order[]> {
    const qb = this.orders
      .createQueryBuilder('o')
      .select('o.shopifyOrderId', 'id');

    /* SEULES les commandes du CONFIGURATEUR.
       Le dashboard est l'écran de travail de l'atelier : il servait les 300
       ventes courantes de la boutique (chaussettes, jeux…), dont aucune n'a de
       flocage à produire — les commandes à personnaliser y étaient noyées.

       Le marqueur est posé à l'enregistrement (WebhooksService.saveOrder) et
       vaut `false` par défaut : l'historique déjà en base reste donc masqué,
       sans reprise de données. */
    qb.andWhere('o.fromConfigurator = TRUE');

    // Filtre par période (sur la date réelle de commande).
    const since = periodStart(opts.period);
    if (since) qb.andWhere('o.shopifyCreatedAt >= :since', { since });

    // Filtre par statut de paiement.
    if (opts.payment && opts.payment !== 'all') {
      qb.andWhere('o.financialStatus = :fin', { fin: opts.payment });
    }
    // Filtre par étape de production.
    if (opts.production && opts.production !== 'all') {
      qb.andWhere('o.productionStatus = :prod', { prod: opts.production });
    }

    // Tri (sur des colonnes légères : évite « Out of sort memory »).
    // COALESCE : une commande sans date Shopify se rabat sur sa date de
    // réception, sinon MySQL la reléguerait tout en bas (NULL) alors qu'elle
    // peut être la plus récente.
    const dateExpr = 'COALESCE(o.shopifyCreatedAt, o.receivedAt)';
    switch (opts.sort) {
      case 'date_asc':
        qb.orderBy(dateExpr, 'ASC');
        break;
      case 'amount_desc':
        qb.orderBy('CAST(o.totalPrice AS DECIMAL(10,2))', 'DESC');
        break;
      case 'amount_asc':
        qb.orderBy('CAST(o.totalPrice AS DECIMAL(10,2))', 'ASC');
        break;
      default:
        qb.orderBy(dateExpr, 'DESC');
    }
    // Départage stable : à date (ou montant) égale, la plus récemment reçue
    // d'abord, puis le plus grand ID Shopify (les IDs sont croissants).
    qb.addOrderBy('o.receivedAt', 'DESC')
      .addOrderBy('o.shopifyOrderId', 'DESC')
      .limit(opts.limit ?? ORDERS_LIMIT);

    const ids = await qb.getRawMany<{ id: string }>();
    if (!ids.length) return [];

    const rows = await this.orders.find({
      where: { shopifyOrderId: In(ids.map((r) => r.id)) },
    });
    return this.reorder(rows, ids.map((r) => String(r.id)), (o) =>
      String(o.shopifyOrderId),
    );
  }

  /** Marque des commandes comme vues (retire le marqueur « nouveau »). */
  async markOrdersSeen(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.orders.update({ shopifyOrderId: In(ids) }, { seen: true });
  }

  /** Marque des devis comme vus. */
  async markQuotesSeen(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.quotes.update({ id: In(ids) }, { seen: true });
  }

  /**
   * État LÉGER du dashboard, pour l'auto-rafraîchissement.
   * Renvoie des compteurs (sans charger le JSON lourd) : le front compare cet
   * état à celui de la page courante et ne recharge QUE s'il a changé.
   *
   * Les compteurs sont PLAFONNÉS aux mêmes limites que les listes affichées
   * (voir ORDERS_LIMIT / QUOTES_LIMIT). Sans ce plafond, une boutique de 350
   * commandes comparait 350 (compteur, table entière) à 300 (liste, tronquée) :
   * l'écart était permanent, la bannière « De nouvelles données sont
   * disponibles » réapparaissait toutes les 30 s et aucun rechargement ne la
   * faisait taire. Les vraies notifications se noyaient dans ce bruit.
   */
  async getStatus(): Promise<{
    orders: number;
    quotes: number;
    designs: number;
    newOrders: number;
    newQuotes: number;
  }> {
    /* Même périmètre que getOrders() : seules les commandes du configurateur.
       Sans ce filtre, le badge annoncerait « 300 commandes » et « 375
       nouvelles » pour une liste vide — l'équipe chercherait des commandes
       inatteignables. */
    const [orders, quotes, designs, newOrders, newQuotes] = await Promise.all([
      this.orders.count({ where: { fromConfigurator: true } }),
      this.quotes.count(),
      this.designs.count(),
      this.orders.count({ where: { fromConfigurator: true, seen: false } }),
      this.quotes.count({ where: { seen: false } }),
    ]);
    return {
      orders: Math.min(orders, ORDERS_LIMIT),
      quotes: Math.min(quotes, QUOTES_LIMIT),
      designs,
      newOrders,
      newQuotes,
    };
  }

  /**
   * Devis, avec filtre de période optionnel.
   *
   * @param includePaid  true (défaut) : tous les devis, y compris ceux déjà
   *   payés — nécessaire pour l'export CSV, qui doit rester exhaustif.
   *   false : masque les devis devenus des commandes (draftStatus
   *   'completed'). Le dashboard les exclut, car la commande correspondante
   *   est déjà listée dans l'onglet Commandes : l'y laisser ferait compter
   *   la même vente deux fois.
   */
  async getQuotes(
    period?: string,
    includePaid = true,
    limit = QUOTES_LIMIT,
  ): Promise<Quote[]> {
    const qb = this.quotes.createQueryBuilder('q').select('q.id', 'id');
    const since = periodStart(period);
    if (since) qb.andWhere('q.createdAt >= :since', { since });
    if (!includePaid) {
      qb.andWhere('(q.draftStatus IS NULL OR q.draftStatus <> :done)', {
        done: 'completed',
      });
    }

    const ids = await qb
      .orderBy('q.createdAt', 'DESC')
      .limit(limit)
      .getRawMany<{ id: string }>();
    if (!ids.length) return [];
    const rows = await this.quotes.find({
      where: { id: In(ids.map((r) => r.id)) },
    });
    return this.reorder(rows, ids.map((r) => r.id), (q) => q.id);
  }

  /** Un devis par son id (pour l'envoi de facture). */
  async getQuote(id: string): Promise<Quote | null> {
    return this.quotes.findOne({ where: { id } });
  }

  /** Met à jour le statut / montant / suivi de relance d'un devis. */
  async updateQuoteStatus(
    id: string,
    patch: Partial<
      Pick<
        Quote,
        | 'draftStatus'
        | 'totalPrice'
        | 'paidOrderId'
        | 'invoiceSentAt'
        | 'remindersSent'
        | 'lastReminderAt'
      >
    >,
  ): Promise<void> {
    await this.quotes.update(id, patch);
  }

  /** Une commande par son id Shopify. */
  async getOrder(shopifyOrderId: string): Promise<Order | null> {
    return this.orders.findOne({ where: { shopifyOrderId } });
  }

  /** Change le statut de production d'une commande. */
  async setProductionStatus(
    shopifyOrderId: string,
    status: string,
  ): Promise<void> {
    await this.orders.update(shopifyOrderId, {
      productionStatus: status,
      productionUpdatedAt: new Date(),
    });
  }

  /**
   * Mémorise le numéro de suivi AVANT l'appel à Shopify.
   *
   * L'expédition enchaînait trois écritures non atomiques : appel Shopify,
   * statut de production, puis suivi. Une interruption entre les deux dernières
   * laissait la commande expédiée chez Shopify — le client ayant DÉJÀ reçu son
   * e-mail — avec un `trackingNumber` resté nul en base. Et il l'était pour
   * toujours : la synchro protège ce champ de l'écrasement, et le bouton
   * « Expédier » refuse de rejouer une commande déjà traitée. Le numéro saisi
   * par l'opérateur était définitivement perdu.
   *
   * En l'écrivant d'abord, le pire cas devient un suivi enregistré pour une
   * expédition qui n'a pas abouti — corrigeable d'un clic, contrairement à
   * l'inverse.
   */
  async setTrackingNumber(
    shopifyOrderId: string,
    trackingNumber: string | null,
  ): Promise<void> {
    await this.orders.update(shopifyOrderId, { trackingNumber });
  }

  /**
   * Enregistre le résultat d'une expédition Shopify.
   *
   * Statut de production et statut d'exécution sont posés dans UNE SEULE
   * écriture : ils décrivent le même événement, les séparer ouvrait une fenêtre
   * où le dashboard affichait « Expédiée » et « Non traitée » simultanément.
   */
  async setShipped(
    shopifyOrderId: string,
    patch: {
      productionStatus: string;
      fulfillmentStatus: string | null;
      trackingNumber: string | null;
    },
  ): Promise<void> {
    await this.orders.update(shopifyOrderId, {
      ...patch,
      productionUpdatedAt: new Date(),
    });
  }

  /** Enregistre la note interne d'une commande. */
  async setInternalNote(
    shopifyOrderId: string,
    note: string,
  ): Promise<void> {
    await this.orders.update(shopifyOrderId, { internalNote: note || null });
  }

  async getDesigns(): Promise<Design[]> {
    const ids = await this.designs
      .createQueryBuilder('d')
      .select('d.id', 'id')
      .orderBy('d.createdAt', 'DESC')
      .limit(300)
      .getRawMany<{ id: string }>();
    if (!ids.length) return [];
    const rows = await this.designs.find({
      where: { id: In(ids.map((r) => r.id)) },
    });
    return this.reorder(rows, ids.map((r) => r.id), (d) => d.id);
  }

  /** Ré-ordonne des lignes selon l'ordre d'une liste d'IDs. */
  private reorder<T>(rows: T[], order: string[], key: (r: T) => string): T[] {
    const map = new Map(rows.map((r) => [key(r), r]));
    return order.map((id) => map.get(id)).filter((r): r is T => !!r);
  }
}
