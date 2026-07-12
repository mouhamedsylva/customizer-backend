import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Authentification simple du dashboard admin :
 *  - un seul mot de passe (ADMIN_PASSWORD)
 *  - un cookie de session signé (HMAC) avec expiration.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private static readonly COOKIE = 'admin_session';
  private static readonly TTL_MS = 1000 * 60 * 60 * 12; // 12 h

  constructor(private readonly config: ConfigService) {}

  get cookieName(): string {
    return AdminAuthService.COOKIE;
  }

  private secret(): string {
    // Clé de signature du cookie : dédiée, sinon repli sur le mot de passe.
    return (
      this.config.get<string>('ADMIN_SESSION_SECRET') ||
      this.config.get<string>('ADMIN_PASSWORD') ||
      'change-me'
    );
  }

  /** Vérifie le mot de passe saisi au login. */
  checkPassword(password: string): boolean {
    const expected = this.config.get<string>('ADMIN_PASSWORD');
    if (!expected) {
      this.logger.warn('ADMIN_PASSWORD non défini : accès admin ouvert.');
      return true; // tolérant tant que non configuré (à définir en prod)
    }
    if (!password) return false;
    try {
      const a = Buffer.from(password);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /** Génère un token de session signé (payload = expiration). */
  issueToken(): string {
    const exp = Date.now() + AdminAuthService.TTL_MS;
    const payload = String(exp);
    const sig = createHmac('sha256', this.secret())
      .update(payload)
      .digest('hex');
    return `${payload}.${sig}`;
  }

  /** Valide un token de session (signature + non expiré). */
  verifyToken(token?: string): boolean {
    if (!token) return false;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const expected = createHmac('sha256', this.secret())
      .update(payload)
      .digest('hex');
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    } catch {
      return false;
    }
    const exp = parseInt(payload, 10);
    return !Number.isNaN(exp) && Date.now() < exp;
  }
}
