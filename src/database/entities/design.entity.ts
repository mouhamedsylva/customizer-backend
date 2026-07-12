import { Column, Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * Design personnalisé partagé/sauvegardé par un client.
 * Remplace le stockage en mémoire (Map) de l'ancien ExportService.
 */
@Entity('designs')
export class Design {
  /** Identifiant de partage (UUID) utilisé dans l'URL ?design=<id>. */
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  /** Type de produit (sweatshirt, tshirt, coins, drapeaux, patches…). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  productType: string | null;

  /** Contenu complet du design (couleur, uploads, textes, positions…). */
  @Column({ type: 'json' })
  designData: Record<string, unknown>;

  /** Numéro de commande Shopify associé, une fois la commande passée (étape 2). */
  @Column({ type: 'bigint', nullable: true })
  shopifyOrderId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
