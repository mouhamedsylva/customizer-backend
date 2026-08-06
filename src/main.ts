import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded, Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import helmet from 'helmet';
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // FILET DE SÉCURITÉ : depuis Node 15, une promesse rejetée sans récepteur
  // ARRÊTE le process. Or les synchros périodiques sont lancées en
  // `void this.xxx()` depuis des timers : le moindre rejet non capturé — une
  // coupure MySQL pendant une passe, par exemple — tuait le backend entier,
  // configurateur et webhooks compris, pour une tâche de fond secondaire.
  //
  // On journalise et on continue : ces tâches sont toutes réessayées au
  // passage suivant. Ce filet ne dispense PAS de gérer les erreurs à la
  // source, il empêche seulement qu'un oubli devienne une panne totale.
  process.on('unhandledRejection', (reason) => {
    Logger.error(
      `Promesse rejetée sans gestionnaire : ${
        reason instanceof Error ? reason.stack || reason.message : String(reason)
      }`,
      'UnhandledRejection',
    );
  });

  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Derrière Nginx (VPS) : sans ceci, req.ip vaudrait l'IP du proxy — le rate
  // limiting compterait toutes les requêtes sur une seule IP, et req.secure
  // serait faux. On fait confiance au premier proxy en amont.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Un NONCE par requête, posé avant helmet pour que la CSP puisse s'y référer.
  //
  // Le dashboard est une page autonome dont les styles et scripts sont inline :
  // la CSP était donc désactivée pour TOUTE l'application, y compris les routes
  // qui n'ont rien à voir avec elle. Le nonce autorise précisément les blocs de
  // la réponse en cours, sans ouvrir `unsafe-inline`.
  app.use(
    (
      req: Request & { cspNonce?: string },
      _res: Response,
      next: NextFunction,
    ) => {
      req.cspNonce = randomBytes(16).toString('base64');
      next();
    },
  );

  // En-têtes de sécurité (nosniff, HSTS, etc.) + CSP.
  const isProd = config.get<string>('NODE_ENV') === 'production';
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          // Le nonce couvre les <script> et <style> émis par admin.view.ts : un
          // script injecté sans nonce est rejeté, même si `'unsafe-inline'`
          // figure ici (un navigateur qui comprend les nonces l'ignore pour les
          // balises).
          scriptSrc: [
            "'self'",
            (req) => `'nonce-${(req as Request & { cspNonce?: string }).cspNonce}'`,
            "'unsafe-inline'",
          ],
          // INDISPENSABLE : `script-src-attr` est plus spécifique que
          // `script-src` et vaut `'none'` dans les défauts de helmet. Sans cette
          // ligne, elle gouverne SEULE les attributs de gestionnaire et bloque
          // les 56 `onclick`/`oninput`/`onblur` du dashboard — y compris le
          // `window.print()` des fiches d'atelier. La page s'affichait
          // normalement et ne répondait plus à aucun clic.
          //
          // Les retirer au profit d'écouteurs délégués permettrait de repasser
          // cette directive à `'none'` : c'est le vrai palier suivant.
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: [
            "'self'",
            (req) => `'nonce-${(req as Request & { cspNonce?: string }).cspNonce}'`,
            "'unsafe-inline'",
          ],
          // Les aperçus de devis peuvent être des data-URL (générées au
          // navigateur), d'où `data:` en plus des deux CDN.
          imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com', 'https://cdn.shopify.com'],
          connectSrc: ["'self'"],
          // Aucun plugin, aucune iframe, et le formulaire de login ne poste
          // que vers cette même origine.
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          baseUri: ["'self'"],
          // Hors production, l'application est servie en HTTP simple : forcer
          // la réécriture en https casserait le dashboard local (et le cookie
          // de session est déjà `secure`). En production, Nginx termine le TLS
          // et la directive reprend tout son sens.
          ...(isProd ? {} : { upgradeInsecureRequests: null }),
        },
      },
    }),
  );

  // Augmente la taille max du body JSON/urlencoded.
  // Les devis "coins" embarquent 3 apercus (recto/verso/cote) en base64,
  // ce qui depasse largement la limite Express par defaut (100 kb) -> erreur 413.
  // `verify` conserve le corps BRUT (req.rawBody) UNIQUEMENT pour les webhooks
  // Shopify, indispensable à la vérification de la signature HMAC.
  app.use(
    json({
      limit: '25mb',
      verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
        // Le test porte sur le CHEMIN SEUL, et il est ancré.
        //
        // `originalUrl.includes('/webhooks/')` regardait aussi la query : une
        // URL comme `/api/quotes?x=/webhooks/` déclenchait donc la copie du
        // corps sur une route publique quelconque. Avec une limite à 25 Mo,
        // chaque requête allouait 50 Mo au lieu de 25 (le buffer d'Express plus
        // sa copie), sans aucune authentification.
        const path = (req.originalUrl || '').split('?')[0];
        if (path.startsWith('/api/webhooks/')) {
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
