import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Modèles de messages personnalisables pour les factures/devis.
 * 
 * Permet à l'admin de personnaliser les messages envoyés aux clients
 * avec support des variables de substitution comme {nom}, {produit}, etc.
 */
@Entity('message_templates')
export class MessageTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'varchar',
    length: 50,
    unique: true,
    comment: 'Type de message : invoice, reminder, etc.'
  })
  type: string;

  @Column({
    type: 'varchar',
    length: 200,
    comment: 'Nom descriptif du modèle'
  })
  name: string;

  @Column({
    type: 'text',
    comment: 'Contenu du message avec variables {nom}, {produit}, etc.'
  })
  content: string;

  @Column({
    type: 'boolean',
    default: true,
    comment: 'Modèle actif ou désactivé'
  })
  isActive: boolean;

  @Column({
    type: 'boolean',
    default: false,
    comment: 'Modèle par défaut pour ce type de message'
  })
  isDefault: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}