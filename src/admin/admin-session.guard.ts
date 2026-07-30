import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AdminAuthService } from './admin-auth.service';

/**
 * Exige une session admin valide (cookie signé).
 *
 * Sert à protéger les routes qui exposent ou détruisent des données mais ne
 * vivent pas dans AdminController — lequel fait sa vérification à la main via
 * `isAuthed(req)`. Plutôt que de dupliquer ce test, on l'encapsule ici :
 *
 *   @UseGuards(AdminSessionGuard)
 *   @Get()
 *   findAll() { … }
 *
 * La validation passe par `currentAdmin()` (et non `verifyToken()`) afin qu'un
 * compte bloqué ou supprimé entre-temps perde immédiatement l'accès : un token
 * signé reste cryptographiquement valide jusqu'à son expiration.
 */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string> | undefined)?.[
      this.auth.cookieName
    ];
    const admin = await this.auth.currentAdmin(token);
    if (!admin) {
      throw new UnauthorizedException('Non authentifié.');
    }
    return true;
  }
}
