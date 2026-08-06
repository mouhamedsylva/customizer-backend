import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Compte administrateur du dashboard.
 *
 * Remplace l'ancien mot de passe unique (ADMIN_PASSWORD) : chaque personne a
 * désormais son propre couple e-mail / mot de passe.
 *
 * Rôles :
 *  - 'owner' : l'admin par défaut (seed). Peut inviter et bloquer les autres.
 *              Il ne peut être ni bloqué ni supprimé (garde-fou anti-lock-out).
 *  - 'admin' : accès au dashboard, mais ne gère pas les autres comptes.
 *
 * Le mot de passe n'est JAMAIS stocké en clair : on garde un hash scrypt
 * (module crypto natif de Node, pas de dépendance externe) au format
 * `scrypt$<salt hex>$<hash hex>`.
 */
@Entity('admins')
export class Admin {
  /** Identifiant interne (UUID). */
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  /** E-mail de connexion (unique, stocké en minuscules). */
  @Column({ type: 'varchar', length: 190, unique: true })
  email: string;

  /** Hash scrypt du mot de passe (`scrypt$salt$hash`). */
  @Column({ type: 'varchar', length: 255 })
  passwordHash: string;

  /** 'owner' (admin par défaut) ou 'admin'. */
  @Column({ type: 'varchar', length: 16, default: 'admin' })
  role: 'owner' | 'admin';

  /** Compte bloqué : la connexion est refusée, le compte reste listé. */
  @Column({ type: 'boolean', default: false })
  blocked: boolean;

  /** E-mail de l'admin qui a créé ce compte (traçabilité). */
  @Column({ type: 'varchar', length: 190, nullable: true })
  invitedBy: string | null;

  /**
   * ID du customer Shopify rattaché à ce compte (créé à l'invitation).
   * null si Shopify était indisponible ou non configuré : le compte admin
   * reste utilisable, le rattachement est un complément.
   */
  @Column({ type: 'bigint', nullable: true })
  shopifyCustomerId: string | null;

  /** Dernière connexion réussie (null tant que jamais connecté). */
  @Column({ type: 'datetime', nullable: true })
  lastLoginAt: Date | null;

  /**
   * Date du dernier changement de mot de passe — sert de POINT DE RÉVOCATION.
   *
   * Elle est incluse dans le cookie signé : tout jeton émis avant cette date
   * est refusé. Sans elle, un cookie volé restait valide jusqu'à 12 h MÊME
   * après changement du mot de passe, et l'owner n'avait aucun moyen de couper
   * sa propre session (il ne peut pas se bloquer lui-même).
   *
   * `null` = jamais changé : les jetons existants restent valides.
   */
  @Column({ type: 'datetime', nullable: true })
  passwordChangedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
