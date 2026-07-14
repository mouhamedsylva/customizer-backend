import { Column, Entity, PrimaryColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * Commande Shopify personnalisée, capturée via le webhook orders/create.
 * Contient tout le nécessaire pour la production (articles, propriétés,
 * URLs d'aperçus/assets Cloudinary, client).
 */
@Entity('orders')
export class Order {
  /** ID Shopify de la commande (clé primaire). */
  @PrimaryColumn({ type: 'bigint' })
  shopifyOrderId: string;

  /** Numéro lisible affiché dans l'admin (ex. #1042). */
  @Index()
  @Column({ type: 'varchar', length: 32, nullable: true })
  orderNumber: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customerEmail: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customerName: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  customerPhone: string | null;

  /** Adresse de livraison + facturation + note client (JSON). */
  @Column({ type: 'json', nullable: true })
  customerInfo: Record<string, unknown> | null;

  /** Total de la commande (chaîne, comme fourni par Shopify). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  totalPrice: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  currency: string | null;

  /**
   * Articles de la commande : chaque item avec titre, quantité, prix,
   * variante, et TOUTES ses propriétés (couleur, taille, URLs aperçus…).
   */
  @Column({ type: 'json' })
  lineItems: unknown[];

  /** Statut financier Shopify (paid, pending…). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  financialStatus: string | null;

  /** Date de création de la commande côté Shopify. */
  @Column({ type: 'datetime', nullable: true })
  shopifyCreatedAt: Date | null;

  /**
   * SUIVI DE PRODUCTION (interne, propre à l'atelier) :
   *  to_produce  → à produire (par défaut)
   *  producing   → en production
   *  ready       → prête
   *  shipped     → expédiée
   */
  @Index()
  @Column({ type: 'varchar', length: 16, default: 'to_produce' })
  productionStatus: string;

  /** Date du dernier changement de statut de production. */
  @Column({ type: 'datetime', nullable: true })
  productionUpdatedAt: Date | null;

  /** Note interne de l'équipe (invisible du client). */
  @Column({ type: 'text', nullable: true })
  internalNote: string | null;

  /** Date d'enregistrement en base (réception du webhook). */
  @CreateDateColumn()
  receivedAt: Date;
}
