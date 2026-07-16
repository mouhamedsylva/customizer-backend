import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'crypto';
import { Admin } from '../database/entities/admin.entity';

/** Admin connecté, tel que reconstitué depuis le cookie de session. */
export interface SessionAdmin {
  id: string;
  email: string;
  role: 'owner' | 'admin';
}

/**
 * Authentification du dashboard admin : e-mail + mot de passe, multi-comptes.
 *
 *  - Mots de passe hachés avec scrypt (crypto natif, aucune dépendance externe).
 *  - Session : cookie signé HMAC contenant `adminId.expiration`.
 *  - Un admin « owner » est créé automatiquement au démarrage (seed) s'il
 *    n'existe aucun compte.
 */
@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);
  private static readonly COOKIE = 'admin_session';
  private static readonly TTL_MS = 1000 * 60 * 60 * 12; // 12 h

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
  ) {}

  /** Au démarrage : crée l'admin par défaut si la table est vide. */
  async onModuleInit(): Promise<void> {
    await this.seedOwner();
  }

  get cookieName(): string {
    return AdminAuthService.COOKIE;
  }

  // ───────────────────────── Hachage des mots de passe ─────────────────────────

  /** Hash scrypt au format `scrypt$<salt hex>$<hash hex>`. */
  private hashPassword(password: string): string {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64);
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
  }

  /** Vérifie un mot de passe contre un hash stocké (comparaison constante). */
  private verifyPassword(password: string, stored: string): boolean {
    if (!password || !stored) return false;
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    try {
      const salt = Buffer.from(parts[1], 'hex');
      const expected = Buffer.from(parts[2], 'hex');
      const actual = scryptSync(password, salt, expected.length);
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    } catch {
      return false;
    }
  }

  /**
   * Génère un mot de passe aléatoire de 8 caractères, lisible : on évite les
   * caractères ambigus (O/0, I/l/1) pour qu'il se dicte et se recopie sans erreur.
   */
  generatePassword(length = 8): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
  }

  // ───────────────────────────────── Seed ─────────────────────────────────

  /**
   * Crée l'admin « owner » par défaut s'il n'existe aucun compte.
   * Identifiants pris dans ADMIN_EMAIL / ADMIN_PASSWORD ; à défaut, un mot de
   * passe aléatoire est généré et affiché UNE FOIS dans les logs de démarrage.
   */
  private async seedOwner(): Promise<void> {
    try {
      const count = await this.admins.count();
      if (count > 0) return;

      const email = (
        this.config.get<string>('ADMIN_EMAIL') || 'admin@customizer.local'
      )
        .trim()
        .toLowerCase();
      const fromEnv = this.config.get<string>('ADMIN_PASSWORD');
      const password = fromEnv || this.generatePassword(12);

      await this.admins.save(
        this.admins.create({
          id: randomUUID(),
          email,
          passwordHash: this.hashPassword(password),
          role: 'owner',
          blocked: false,
          invitedBy: null,
          shopifyCustomerId: null,
          lastLoginAt: null,
        }),
      );

      this.logger.log(`Admin par défaut créé : ${email}`);
      if (!fromEnv) {
        // Sans ADMIN_PASSWORD, on affiche le mot de passe généré : c'est la
        // seule occasion de le lire (il n'est stocké que haché).
        this.logger.warn(
          `Mot de passe généré pour ${email} : ${password} — notez-le puis changez-le.`,
        );
      }
    } catch (e) {
      // La table n'existe peut-être pas encore au tout premier démarrage.
      this.logger.error(`Seed admin impossible : ${(e as Error).message}`);
    }
  }

  // ──────────────────────────────── Connexion ────────────────────────────────

  /**
   * Vérifie e-mail + mot de passe. Renvoie l'admin si OK, sinon null.
   * Un compte bloqué ne peut pas se connecter.
   */
  async login(email: string, password: string): Promise<Admin | null> {
    const mail = String(email || '')
      .trim()
      .toLowerCase();
    if (!mail || !password) return null;

    const admin = await this.admins.findOne({ where: { email: mail } });
    if (!admin) return null;
    if (admin.blocked) return null;
    if (!this.verifyPassword(password, admin.passwordHash)) return null;

    admin.lastLoginAt = new Date();
    await this.admins.save(admin);
    return admin;
  }

  // ──────────────────────────────── Session ────────────────────────────────

  private secret(): string {
    return (
      this.config.get<string>('ADMIN_SESSION_SECRET') ||
      this.config.get<string>('ADMIN_PASSWORD') ||
      'change-me'
    );
  }

  /** Token de session signé : `<adminId>.<expiration>.<signature>`. */
  issueToken(adminId: string): string {
    const exp = Date.now() + AdminAuthService.TTL_MS;
    const payload = `${adminId}.${exp}`;
    const sig = createHmac('sha256', this.secret()).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }

  /**
   * Validation SYNCHRONE du cookie (signature + expiration), sans accès BDD.
   * Suffisant pour protéger les routes ; `currentAdmin()` complète avec
   * l'identité et l'état (bloqué/supprimé) quand c'est nécessaire.
   */
  verifyToken(token?: string): boolean {
    return this.parseToken(token) !== null;
  }

  /** Valide un token et renvoie l'id de l'admin, ou null. */
  private parseToken(token?: string): string | null {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [adminId, expStr, sig] = parts;
    const expected = createHmac('sha256', this.secret())
      .update(`${adminId}.${expStr}`)
      .digest('hex');
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    } catch {
      return null;
    }
    const exp = parseInt(expStr, 10);
    if (Number.isNaN(exp) || Date.now() >= exp) return null;
    return adminId;
  }

  /**
   * Admin courant à partir du cookie. Renvoie null si le token est invalide,
   * expiré, ou si le compte a été bloqué/supprimé entre-temps.
   */
  async currentAdmin(token?: string): Promise<SessionAdmin | null> {
    const adminId = this.parseToken(token);
    if (!adminId) return null;
    const admin = await this.admins.findOne({ where: { id: adminId } });
    if (!admin || admin.blocked) return null;
    return { id: admin.id, email: admin.email, role: admin.role };
  }

  // ────────────────────────── Gestion des comptes ──────────────────────────

  /** Liste des admins (plus récents d'abord), sans les hash. */
  async list(): Promise<Admin[]> {
    return this.admins.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * Vérifie qu'un e-mail est valide et pas déjà utilisé par un admin.
   * Appelée AVANT le rattachement Shopify, pour ne pas créer un client
   * inutilement si l'invitation ne peut pas aboutir.
   */
  async validateNewEmail(email: string): Promise<{ ok: boolean; error?: string }> {
    const mail = String(email || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      return { ok: false, error: 'E-mail invalide.' };
    }
    const exists = await this.admins.findOne({ where: { email: mail } });
    if (exists) return { ok: false, error: 'Cet e-mail est déjà utilisé.' };
    return { ok: true };
  }

  /**
   * Crée un admin avec un mot de passe fourni (généré côté serveur).
   * Renvoie { ok:false, error } si l'e-mail est invalide ou déjà utilisé.
   */
  async createAdmin(
    email: string,
    password: string,
    invitedBy: string,
    shopifyCustomerId?: string | null,
  ): Promise<{ ok: boolean; error?: string; admin?: Admin }> {
    const mail = String(email || '')
      .trim()
      .toLowerCase();
    const valid = await this.validateNewEmail(mail);
    if (!valid.ok) return { ok: false, error: valid.error };
    if (!password || password.length < 8) {
      return { ok: false, error: 'Mot de passe trop court (8 caractères min).' };
    }

    const admin = await this.admins.save(
      this.admins.create({
        id: randomUUID(),
        email: mail,
        passwordHash: this.hashPassword(password),
        role: 'admin',
        blocked: false,
        invitedBy: invitedBy || null,
        shopifyCustomerId: shopifyCustomerId || null,
        lastLoginAt: null,
      }),
    );
    return { ok: true, admin };
  }

  /**
   * Bloque / débloque un admin. L'owner ne peut jamais être bloqué (garde-fou),
   * et personne ne peut se bloquer soi-même.
   */
  async setBlocked(
    id: string,
    blocked: boolean,
    actorId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const admin = await this.admins.findOne({ where: { id } });
    if (!admin) return { ok: false, error: 'Admin introuvable.' };
    if (admin.role === 'owner') {
      return { ok: false, error: "L'admin principal ne peut pas être bloqué." };
    }
    if (admin.id === actorId) {
      return { ok: false, error: 'Vous ne pouvez pas vous bloquer vous-même.' };
    }
    admin.blocked = blocked;
    await this.admins.save(admin);
    return { ok: true };
  }

  /** Régénère le mot de passe d'un admin ; renvoie le nouveau (en clair, une fois). */
  async resetPassword(
    id: string,
  ): Promise<{ ok: boolean; error?: string; password?: string; email?: string }> {
    const admin = await this.admins.findOne({ where: { id } });
    if (!admin) return { ok: false, error: 'Admin introuvable.' };
    const password = this.generatePassword(8);
    admin.passwordHash = this.hashPassword(password);
    await this.admins.save(admin);
    return { ok: true, password, email: admin.email };
  }
}
