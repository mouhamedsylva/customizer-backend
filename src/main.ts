import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded, Request } from 'express';
import helmet from 'helmet';
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Derrière Nginx (VPS) : sans ceci, req.ip vaudrait l'IP du proxy — le rate
  // limiting compterait toutes les requêtes sur une seule IP, et req.secure
  // serait faux. On fait confiance au premier proxy en amont.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // En-têtes de sécurité (nosniff, HSTS, etc.). `contentSecurityPolicy`
  // désactivé : le dashboard admin est une page HTML autonome avec styles et
  // scripts inline (admin.view.ts) qu'une CSP par défaut casserait.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Augmente la taille max du body JSON/urlencoded.
  // Les devis "coins" embarquent 3 apercus (recto/verso/cote) en base64,
  // ce qui depasse largement la limite Express par defaut (100 kb) -> erreur 413.
  // `verify` conserve le corps BRUT (req.rawBody) UNIQUEMENT pour les webhooks
  // Shopify, indispensable à la vérification de la signature HMAC.
  app.use(
    json({
      limit: '25mb',
      verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
        if (req.originalUrl && req.originalUrl.includes('/webhooks/')) {
          req.rawBody = Buffer.from(buf);
        }
      },
    }),
  );
  app.use(urlencoded({ limit: '25mb', extended: true }));

  // Cookies (session du dashboard admin).
  app.use(cookieParser());

  // Prefixe global de toutes les routes : /api/...
  app.setGlobalPrefix('api');

  // CORS : autorise le frontend configuré (FRONTEND_URL) + variantes utiles.
  // En développement, on accepte aussi le domaine Shopify et localhost.
  const frontendUrl =
    config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
  const allowedOrigins = [
    frontendUrl,
    frontendUrl.replace(/^https?:\/\//, 'https://'),
    'http://localhost:9292',    // shopify theme dev
    'http://127.0.0.1:9292',
  ];
  /**
   * Une origine est-elle un sous-domaine `.myshopify.com` ?
   *
   * On compare le HOSTNAME parsé, pas la chaîne brute : `endsWith` seul
   * accepterait `https://evil-myshopify.com`, qui se termine bien par
   * `myshopify.com` sans en être un sous-domaine.
   */
  const isShopifyOrigin = (origin: string): boolean => {
    try {
      const { hostname, protocol } = new URL(origin);
      return protocol === 'https:' && hostname.endsWith('.myshopify.com');
    } catch {
      return false;
    }
  };

  /**
   * L'origine est-elle celle de l'API elle-même ?
   *
   * Le dashboard admin est servi par cette API (`GET /api/admin`) : ses appels
   * `fetch` sont donc same-origin. Le navigateur n'y applique pas le CORS,
   * mais il envoie quand même l'en-tête `Origin` sur les POST — sans ce test,
   * chaque action du dashboard émettait un « CORS refusé » alarmant alors que
   * tout fonctionnait, ce qui aurait masqué un vrai refus.
   */
  const isSameOrigin = (origin: string, host?: string): boolean => {
    if (!host) return false;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  };

  // Délégué (et non options figées) : il reçoit la requête, seul moyen de
  // comparer l'origine au host réellement servi.
  app.enableCors((req: Request, callback) => {
    const origin = req.headers.origin;
    const allowed =
      // Pas d'origine = appel serveur-à-serveur (curl, webhooks Shopify) :
      // le navigateur n'est pas impliqué, donc rien à protéger ici.
      !origin ||
      allowedOrigins.includes(origin) ||
      isShopifyOrigin(origin) ||
      isSameOrigin(origin, req.headers.host);

    if (!allowed) {
      // `credentials: true` étant actif, laisser passer toute origine
      // exposerait les réponses authentifiées du dashboard.
      //
      // On refuse en N'ÉMETTANT PAS l'en-tête `Access-Control-Allow-Origin`
      // plutôt qu'en levant une Error : une Error produirait une 500, qui
      // ferait passer un refus de sécurité pour une panne du serveur.
      Logger.warn(`CORS refusé pour l'origine ${origin}`, 'Bootstrap');
    }

    callback(null, {
      origin: allowed,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      credentials: true,
    });
  });

  // Validation automatique des DTOs (class-validator) sur toutes les routes.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Active les hooks d'arrêt : sur SIGTERM (docker compose down/restart), Nest
  // appelle les onModuleDestroy — clearInterval sur les 3 timers de synchro —
  // au lieu de couper le process en plein milieu d'une écriture.
  app.enableShutdownHooks();

  const port = parseInt(config.get<string>('PORT') || '3000', 10);
  await app.listen(port);

  Logger.log(`Customizer backend demarre sur http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
