import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Réglages de l'atelier, modifiables depuis le dashboard admin.
 * Stockage clé/valeur : simple, et évite une migration à chaque nouveau réglage.
 *
 * Clés utilisées :
 *  - reminder_enabled    : '1' | '0'      relances automatiques actives
 *  - reminder_days       : '3,7,14'       jours après l'envoi de la facture
 *  - notify_email_enabled: '1' | '0'      e-mail à l'équipe sur nouvelle activité
 *  - notify_email        : adresse de l'équipe
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
