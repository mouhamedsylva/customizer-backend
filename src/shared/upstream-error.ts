import { HttpException, HttpStatus, Logger } from '@nestjs/common';

/**
 * Normalise les erreurs d'appels sortants (Shopify surtout).
 *
 * Deux problèmes que ce helper corrige, répétés dans ~8 blocs try/catch :
 *  1. Le message brut de Shopify (corps de réponse, parfois verbeux) était
 *     renvoyé TEL QUEL au client public → fuite d'informations internes.
 *  2. Le code HTTP était figé (souvent 404 ou 502) sans rapport avec la nature
 *     réelle de l'erreur.
 *
 * Le détail complet reste journalisé côté serveur ; le client ne reçoit qu'un
 * message générique et un code cohérent (502 par défaut : panne d'un service
 * en amont, pas une faute du client).
 */
export function throwUpstream(
  logger: Logger,
  publicMessage: string,
  error: unknown,
  status: HttpStatus = HttpStatus.BAD_GATEWAY,
): never {
  const detail = error instanceof Error ? error.message : String(error);
  logger.error(`${publicMessage} — cause: ${detail}`);
  throw new HttpException(publicMessage, status);
}
