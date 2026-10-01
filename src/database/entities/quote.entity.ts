import { Column, Entity, Index, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * Demande de devis (patchs PVC/Tissé, coins…).
 * Remplace le stockage en mémoire (Map) de l'ancien QuotesService.
 */
/* Index posés à la main par 1759300000000-IndexDevis.sql (mêmes noms) : sans
   eux, les tâches périodiques triaient des lignes complètes en mémoire. */
@Index('IDX_quotes_createdAt', ['createdAt'])
@Index('IDX_quotes_status_invoiceSentAt', ['draftStatus', 'invoiceSentAt'])
@Index('IDX_quotes_draftOrderId', ['draftOrderId'])
@Index('IDX_quotes_seen', ['seen'])
@Entity('quotes')
export class Quote {
  /** Référence du devis (UUID). */
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  /** Contenu complet de la demande (customer + coin/patch + previews). */
  @Column({ type: 'json' })
  quoteData: Record<string, unknown>;

  /** ID du draft order Shopify créé pour ce devis (best effort). */
  @Column({ type: 'bigint', nullable: true })
  draftOrderId: string | null;

  /**
   * Statut du brouillon Shopify, synchronisé périodiquement :
   *  - null          : devis tout juste créé, brouillon pas encore confirmé
   *  - failed        : la création du brouillon a échoué ; `retryOrphanQuotes`
   *                    réessaie toutes les 10 min et remet le statut à null
   *  - open          : devis créé, pas encore chiffré/envoyé
   *  - invoice_sent  : facture envoyée, en attente de paiement
   *  - completed     : PAYÉ (Shopify a créé la commande)
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  draftStatus: string | null;

  /** ID de la commande Shopify créée après paiement (null tant que non payé). */
  @Column({ type: 'bigint', nullable: true })
  paidOrderId: string | null;

  /** Montant total du brouillon (défini au chiffrage). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  totalPrice: string | null;

  /** Date d'envoi de la facture (point de départ des relances). */
  @Column({ type: 'datetime', nullable: true })
  invoiceSentAt: Date | null;

  /** Nombre de relances déjà envoyées (évite les doublons). */
  @Column({ type: 'int', default: 0 })
  remindersSent: number;

  /** Date de la dernière relance. */
  @Column({ type: 'datetime', nullable: true })
  lastReminderAt: Date | null;

  /** Pièces jointes temporaires pour la facturation (URLs Cloudinary) */
  @Column({ type: 'json', nullable: true })
  tempAttachments: Array<{
    name: string;
    url: string;
    type: string;
    size?: string;
    uploadedAt: string;
  }> | null;

  /** Faux tant que l'équipe n'a pas ouvert le devis (marqueur « nouveau »). */
  @Column({ type: 'boolean', default: false })
  seen: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
