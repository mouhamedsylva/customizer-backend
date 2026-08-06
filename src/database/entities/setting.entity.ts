import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Réglages de l'atelier, modifiables depuis le dashboard admin.
 * Stockage clé/valeur : simple, et évite une migration à chaque nouveau réglage.
 *
 * Clés utilisées :
 *  - reminder_enabled    : '1' | '0'      relances automatiques actives
 *  - reminder_days       : '3,7,14'       jours après l'envoi de la facture
 *  - price_<produit>     : prix unitaire du configurateur
 *  - tiers_<produit>     : grille dégressive (JSON)
 *  - admin_session_secret: clé de signature des cookies de session
 *  - cart_token_secret   : clé de signature des jetons de panier
 *
 * Les anciennes clés `notify_email_enabled` / `notify_email` ne sont plus
 * lues : le backend n'émet aucun e-mail, toute la correspondance passe par
 * Shopify. Les lignes résiduelles en base sont simplement ignorées.
 */
@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'text', nullable: true })
  value: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
