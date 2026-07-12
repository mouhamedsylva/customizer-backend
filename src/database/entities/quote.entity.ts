import { Column, Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * Demande de devis (patchs PVC/Tissé, coins…).
 * Remplace le stockage en mémoire (Map) de l'ancien QuotesService.
 */
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

  @CreateDateColumn()
  createdAt: Date;
}
