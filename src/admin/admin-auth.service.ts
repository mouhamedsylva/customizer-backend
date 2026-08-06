import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'crypto';
import { Admin } from '../database/entities/admin.entity';
import { Setting } from '../database/entities/setting.entity';

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
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
  ) {}

  /** Au démarrage : résout le secret de session, puis crée l'admin par défaut. */
  async onModuleInit(): Promise<void> {
    // Résolu MAINTENANT et mis en cache : `secret()` est synchrone (appelé
    // depuis issueToken/parseToken) alors que la lecture en base ne l'est pas.
    await this.resolveSecret();
    await this.seedOwner();
  }

  get cookieName(): string {
    return AdminAuthService.COOKIE;
  }

  // ───────────────────────── Hachage des mots de passe ─────────────────────────

  /**
   * scrypt ASYNCHRONE.
   *
   * `scryptSync` coûte ~50 ms et bloque l'ENTIER event loop pendant ce temps :
   * aucune requête, aucun webhook, aucun timer n'est servi. Une vingtaine de
   * tentatives de connexion par seconde suffisaient donc à figer le serveur.
   * La version asynchrone s'exécute sur le threadpool libuv et laisse le
   * process répondre.
   */
  private scrypt(
    password: string,
    salt: Buffer,
    keylen: number,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(password, salt, keylen, (err, derived) =>
        err ? reject(err) : resolve(derived),
      );
    });
  }

  /** Hash scrypt au format `scrypt$<salt hex>$<hash hex>`. */
  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await this.scrypt(password, salt, 64);
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
  }

  /** Vérifie un mot de passe contre un hash stocké (comparaison constante). */
  private async verifyPassword(
    password: string,
    stored: string,
  ): Promise<boolean> {
    if (!password || !stored) return false;
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    try {
      const salt = Buffer.from(parts[1], 'hex');
      const expected = Buffer.from(parts[2], 'hex');
      const actual = await this.scrypt(password, salt, expected.length);
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
   *
   * L'e-mail est fixe (il faut bien un identifiant connu pour la première
   * connexion), mais le MOT DE PASSE est tiré au hasard à chaque seed et
   * affiché une seule fois dans les logs de démarrage.
   *
   * Il était auparavant écrit en dur dans ce fichier, donc dans Git : toute
   * personne ayant lu le dépôt pouvait se connecter au dashboard d'une
   * instance dont l'exploitant n'avait pas changé le mot de passe — et rien
   * ne l'y obligeait.
   *
   * `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` permettent de fixer les deux
   * en déploiement automatisé.
   */
  private static readonly DEFAULT_EMAIL = 'admin@customizer.com';

  private async seedOwner(): Promise<void> {
    try {
      const count = await this.admins.count();
      if (count > 0) return;

      const email = (
        this.config.get<string>('ADMIN_SEED_EMAIL') ||
        AdminAuthService.DEFAULT_EMAIL
      )
        .trim()
        .toLowerCase();

      const provided = this.config.get<string>('ADMIN_SEED_PASSWORD');
      const password = provided || this.generatePassword(16);

      const passwordHash = await this.hashPassword(password);
      await this.admins.save(
        this.admins.create({
          id: randomUUID(),
          email,
          passwordHash,
          role: 'owner',
          blocked: false,
          invitedBy: null,
          shopifyCustomerId: null,
          lastLoginAt: null,
          passwordChangedAt: null,
        }),
      );

      if (provided) {
        this.logger.log(`Admin par défaut créé : ${email}`);
      } else {
        // Seule et unique occasion de lire ce mot de passe : il n'est stocké
        // que haché. En Docker : `docker compose logs api | grep MOT DE PASSE`.
        this.logger.warn(
          `\n${'='.repeat(64)}\n` +
            `ADMIN CRÉÉ — notez ces identifiants, ils ne seront plus affichés\n` +
            `  E-mail       : ${email}\n` +
            `  MOT DE PASSE : ${password}\n` +
            `Changez-le après connexion (Admins → Nouveau mot de passe).\n` +
            `${'='.repeat(64)}`,
        );
      }
    } catch (e) {
      // La table n'existe peut-être pas encore au tout premier démarrage.
      this.logger.error(`Seed admin impossible : ${(e as Error).message}`);
    }
  }

  // ──────────────────────────────── Connexion ────────────────────────────────

  /**
   * Hash factice, utilisé quand aucun compte ne correspond.
   *
   * Il est vérifié pour rien, uniquement pour consommer le MÊME temps qu'une
   * vérification réelle. Sans cela, un e-mail inconnu renvoyait en ~2 ms là où
   * un e-mail valide prenait ~50 ms : un écart d'un facteur 25, mesurable en
   * une seule requête, qui révélait quels comptes existent et transformait un
   * bruteforce aveugle en attaque ciblée.
   */
  private static readonly DUMMY_HASH =
    'scrypt$' +
    '00000000000000000000000000000000$' +
    '0'.repeat(128);

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

    // Le hachage est TOUJOURS exécuté, même sans compte correspondant : c'est
    // ce qui égalise les temps de réponse (cf. DUMMY_HASH).
    const ok = await this.verifyPassword(
      password,
      admin?.passwordHash || AdminAuthService.DUMMY_HASH,
    );
    if (!admin || admin.blocked || !ok) return null;

    admin.lastLoginAt = new Date();
    await this.admins.save(admin);
    return admin;
  }

  // ──────────────────────────────── Session ────────────────────────────────

  /** Clé de signature des cookies de session, résolue au démarrage. */
  private cachedSecret?: string;

  /** Clé de stockage du secret auto-généré. */
  private static readonly SECRET_KEY = 'admin_session_secret';

  /**
   * Détermine la clé de signature des sessions, par ordre de priorité :
   *
   *   1. `ADMIN_SESSION_SECRET` (32 caractères minimum) ;
   *   2. le secret déjà généré et stocké en base ;
   *   3. un nouveau secret aléatoire, écrit en base pour les prochains boots.
   *
   * Le repli était auparavant la chaîne littérale `'change-me'` : comme la
   * variable n'était documentée nulle part, toute installation signait ses
   * cookies avec une constante publique, donc forgeable.
   *
   * La persistance en base plutôt qu'un simple tirage en mémoire est ce qui
   * rend l'auto-génération utilisable : un secret regénéré à chaque
   * redémarrage déconnecterait tout le monde à chaque `docker compose up`.
   */
  private async resolveSecret(): Promise<string> {
    if (this.cachedSecret) return this.cachedSecret;

    // Le repli sur `ADMIN_PASSWORD` a été RETIRÉ.
    //
    // C'était un vestige de l'ancien système d'authentification, documenté dans
    // aucun `.env.example`. Une installation qui l'avait encore signait ses
    // cookies avec un mot de passe humain (~40 bits) là où 256 sont attendus :
    // un secret devinable permet de FORGER un cookie de session admin valide.
    // Et le supprimer en croyant nettoyer faisait tomber toutes les sessions,
    // sans que rien n'explique pourquoi.
    const configured = this.config.get<string>('ADMIN_SESSION_SECRET');
    if (configured) {
      if (configured.length < 32) {
        throw new Error(
          'ADMIN_SESSION_SECRET trop court (32 caractères minimum) : ' +
            'générez-le avec `openssl rand -hex 32`.',
        );
      }
      this.cachedSecret = configured;
      return configured;
    }

    try {
      const row = await this.settings.findOne({
        where: { key: AdminAuthService.SECRET_KEY },
      });
      if (row?.value) {
        this.cachedSecret = row.value;
        return row.value;
      }

      const generated = randomBytes(32).toString('hex');
      await this.settings.save(
        this.settings.create({
          key: AdminAuthService.SECRET_KEY,
          value: generated,
        }),
      );
      this.cachedSecret = generated;
      this.logger.warn(
        'ADMIN_SESSION_SECRET absent : un secret aléatoire a été généré et ' +
          'enregistré en base. Pour le maîtriser vous-même, définissez ' +
          'ADMIN_SESSION_SECRET (openssl rand -hex 32) — cela invalidera les ' +
          'sessions en cours.',
      );
      return generated;
    } catch (e) {
      // Base indisponible : on ne bloque pas le démarrage. Le secret vaut pour
      // la durée du process ; les sessions ne survivront pas au redémarrage,
      // mais l'application reste utilisable et rien n'est signé avec une
      // valeur prévisible.
      this.cachedSecret = randomBytes(32).toString('hex');
      this.logger.error(
        `Secret de session non persisté (${(e as Error).message}) : ` +
          'secret éphémère utilisé, les sessions tomberont au prochain ' +
          'redémarrage.',
      );
      return this.cachedSecret;
    }
  }

  /**
   * Clé de signature. Synchrone car appelée depuis `issueToken`/`parseToken` ;
   * elle s'appuie sur le cache rempli par `resolveSecret()` au démarrage.
   */
  private secret(): string {
    if (!this.cachedSecret) {
      // Ne devrait pas arriver : `onModuleInit` résout le secret avant que la
      // moindre requête ne soit servie. Filet de sécurité pour ne jamais
      // signer avec une valeur vide.
      throw new Error(
        'Secret de session non initialisé — le démarrage ne s’est pas ' +
          'déroulé normalement.',
      );
    }
    return this.cachedSecret;
  }

  /**
   * Token de session signé : `<adminId>.<émission>.<expiration>.<signature>`.
   *
   * La date d'ÉMISSION est nouvelle : elle est comparée à `passwordChangedAt`
   * pour permettre la révocation. Sans elle, un cookie volé restait utilisable
   * jusqu'à 12 h après un changement de mot de passe.
   */
  issueToken(adminId: string): string {
    const iat = Date.now();
    const exp = iat + AdminAuthService.TTL_MS;
    const payload = `${adminId}.${iat}.${exp}`;
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

  /**
   * Valide un token et renvoie l'id de l'admin + sa date d'émission.
   *
   * Deux formats sont acceptés : `<id>.<iat>.<exp>.<sig>` (actuel) et
   * `<id>.<exp>.<sig>` (ancien). L'ancien est toléré pour que le déploiement
   * ne déconnecte pas les admins en cours de travail ; il ne porte pas de date
   * d'émission, donc `iat` vaut null et la révocation ne peut pas s'appliquer
   * — ces jetons s'éteignent d'eux-mêmes en 12 h au plus.
   */
  private parseToken(
    token?: string,
  ): { adminId: string; iat: number | null } | null {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 4 && parts.length !== 3) return null;

    const legacy = parts.length === 3;
    const adminId = parts[0];
    const iatStr = legacy ? null : parts[1];
    const expStr = legacy ? parts[1] : parts[2];
    const sig = legacy ? parts[2] : parts[3];

    const payload = legacy
      ? `${adminId}.${expStr}`
      : `${adminId}.${iatStr}.${expStr}`;
    const expected = createHmac('sha256', this.secret())
      .update(payload)
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

    const iat = iatStr === null ? null : parseInt(iatStr, 10);
    if (iat !== null && Number.isNaN(iat)) return null;
    return { adminId, iat };
  }

  /**
   * Admin courant à partir du cookie. Renvoie null si le token est invalide,
   * expiré, ou si le compte a été bloqué/supprimé entre-temps.
   */
  async currentAdmin(token?: string): Promise<SessionAdmin | null> {
    const parsed = this.parseToken(token);
    if (!parsed) return null;
    const admin = await this.admins.findOne({ where: { id: parsed.adminId } });
    if (!admin || admin.blocked) return null;

    // RÉVOCATION : un jeton émis avant le dernier changement de mot de passe
    // n'est plus valable. C'est ce qui rend le changement de mot de passe
    // réellement protecteur — jusqu'ici, un cookie volé survivait 12 h de plus.
    //
    // On retranche une seconde : la date en base est un `datetime` MySQL, dont
    // la précision descend à la seconde, alors que `iat` est en millisecondes.
    // Sans cette marge, le jeton émis juste après un changement pouvait se
    // retrouver « antérieur » à lui et l'admin était déconnecté aussitôt.
    if (parsed.iat !== null && admin.passwordChangedAt) {
      const changedAt = new Date(admin.passwordChangedAt).getTime() - 1000;
      if (parsed.iat < changedAt) return null;
    }

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

    const passwordHash = await this.hashPassword(password);
    const admin = await this.admins.save(
      this.admins.create({
        id: randomUUID(),
        email: mail,
        passwordHash,
        role: 'admin',
        blocked: false,
        invitedBy: invitedBy || null,
        shopifyCustomerId: shopifyCustomerId || null,
        lastLoginAt: null,
        passwordChangedAt: null,
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

  /**
   * Régénère le mot de passe d'un admin ; renvoie le nouveau (en clair, une fois).
   *
   * `actorId` permet de refuser l'auto-réinitialisation. C'est un garde-fou
   * anti-verrouillage : le mot de passe généré n'est affiché QU'UNE FOIS et
   * n'est stocké que haché. Si l'owner se réinitialisait lui-même et perdait
   * la réponse (onglet fermé, coupure réseau), il se retrouvait dehors
   * définitivement — il n'existe aucune récupération par e-mail, et
   * `createAdmin` force `role: 'admin'`, donc l'owner est unique et
   * irremplaçable. `changeOwnPassword` couvre déjà ce besoin, en exigeant le
   * mot de passe actuel.
   */
  async resetPassword(
    id: string,
    actorId?: string,
  ): Promise<{ ok: boolean; error?: string; password?: string; email?: string }> {
    const admin = await this.admins.findOne({ where: { id } });
    if (!admin) return { ok: false, error: 'Admin introuvable.' };
    if (actorId && admin.id === actorId) {
      return {
        ok: false,
        error:
          'Utilisez « Changer mon mot de passe » pour votre propre compte : ' +
          'la réinitialisation ne montre le nouveau mot de passe qu’une fois.',
      };
    }
    const password = this.generatePassword(8);
    admin.passwordHash = await this.hashPassword(password);
    // Révoque les sessions ouvertes de ce compte (cf. currentAdmin).
    admin.passwordChangedAt = new Date();
    await this.admins.save(admin);
    return { ok: true, password, email: admin.email };
  }

  /**
   * Change le mot de passe de l'admin CONNECTÉ.
   *
   * Le mot de passe actuel est exigé : sans cette vérification, quiconque
   * accède à une session ouverte (poste non verrouillé, cookie volé) pourrait
   * changer le mot de passe et verrouiller le propriétaire dehors.
   */
  async changeOwnPassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: boolean; error?: string; token?: string }> {
    const admin = await this.admins.findOne({ where: { id } });
    if (!admin) return { ok: false, error: 'Compte introuvable.' };

    if (!(await this.verifyPassword(currentPassword || '', admin.passwordHash))) {
      return { ok: false, error: 'Mot de passe actuel incorrect.' };
    }

    const pwd = String(newPassword || '');
    if (pwd.length < 8) {
      return {
        ok: false,
        error: 'Le nouveau mot de passe doit faire au moins 8 caractères.',
      };
    }
    if (await this.verifyPassword(pwd, admin.passwordHash)) {
      return { ok: false, error: 'Le nouveau mot de passe est identique à l’actuel.' };
    }

    admin.passwordHash = await this.hashPassword(pwd);
    // Révoque TOUTES les sessions de ce compte, y compris celle en cours : si
    // le mot de passe est changé parce qu'un cookie a fuité, laisser vivre les
    // sessions existantes viderait l'opération de son sens.
    admin.passwordChangedAt = new Date();
    await this.admins.save(admin);
    this.logger.log(`Mot de passe changé pour ${admin.email}`);

    // ... mais on rend un jeton neuf à l'appelant : celui qui vient de changer
    // son mot de passe légitimement ne doit pas être éjecté de son dashboard.
    return { ok: true, token: this.issueToken(admin.id) };
  }
}
