import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded, Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import helmet from 'helmet';
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';
import { verifierEnv } from './config/verifier-env';

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

  /* Configuration vérifiée AVANT tout, et signalée en tête des logs du
     conteneur : sans cela, une variable absente ne se révélait qu'à l'usage
     (webhooks en 401, uploads en 502…), loin de sa cause. Le démarrage n'est
     pas bloqué : une fonction secondaire mal configurée ne doit pas couper le
     configurateur. Le bilan est aussi exposé à l'admin par /api/health/details. */
  const bilan = verifierEnv(process.env);
  for (const a of bilan.avertissements) Logger.warn(`Configuration : ${a}`, 'Bootstrap');
  for (const c of bilan.critiques) Logger.error(`Configuration MANQUANTE : ${c}`, 'Bootstrap');

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
          // MÊME PIÈGE pour les attributs `style="…"` : le nonce de `styleSrc`
          // y fait ignorer `'unsafe-inline'`, et le navigateur les rejetait
          // tous. Visible dans la fenêtre de chiffrage : le bouton natif
          // « Sélect. fichiers » (masqué par style="display:none") apparaissait
          // et la zone de dépôt perdait sa mise en forme. Les balises <style>
          // restent, elles, soumises au nonce.
          styleSrcAttr: ["'unsafe-inline'"],
          styleSrc: [
            "'self'",
            (req) => `'nonce-${(req as Request & { cspNonce?: string }).cspNonce}'`,
            "'unsafe-inline'",
          ],
          // Les aperçus de devis peuvent être des data-URL (générées au
          // navigateur), d'où `data:` en plus des CDN.
          //
          // Cette liste DOIT suivre les trois autres : IMG_HOSTS
          // (admin.view.ts), ASSET_HOSTS (admin.controller.ts) et
          // ALLOWED_IMAGE_HOSTS (cloudinary.service.ts). Un hôte ajouté
          // ailleurs mais oublié ici passe les contrôles serveur, puis le
          // navigateur refuse de charger l'image : la vignette reste vide,
          // sans message ailleurs que dans la console.
          imgSrc: [
            "'self'",
            'data:',
            'https://res.cloudinary.com',
            'https://cdn.shopify.com',
            'https://massacre-officiel.com',
          ],
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

  // Cookies (session du dashboard admin).
  app.use(cookieParser());

  // Prefixe global de toutes les routes : /api/...
  app.setGlobalPrefix('api');

  // CORS : autorise le frontend configuré (FRONTEND_URL) + variantes utiles.
  // En développement, on accepte aussi le domaine Shopify et localhost.
  const frontendUrl =
    config.get<string>('FRONTEND_URL') || 'http://localhost:3000';

  /* FRONTEND_URL accepte PLUSIEURS origines séparées par des virgules.
     Une boutique Shopify en a toujours au moins deux : son `.myshopify.com`
     (couvert par isShopifyOrigin) et son domaine personnalisé, sur lequel les
     clients naviguent réellement. Avec une valeur unique, le second restait
     hors liste : le backend répondait 200 sans en-tête CORS, le navigateur
     bloquait la lecture, et le configurateur retombait silencieusement sur ses
     prix de repli — un changement de tarif dans le dashboard n'atteignait
     jamais la boutique. */
  const frontendUrls = frontendUrl
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  const allowedOrigins = [
    ...frontendUrls,
    ...frontendUrls.map((u) => u.replace(/^https?:\/\//, 'https://')),
    'http://localhost:9292',    // shopify theme dev
    'http://127.0.0.1:9292',
    'https://vps-c1a07d74.vps.ovh.net', // sans schéma, l'entrée ne correspondait jamais
  ];

  /* Domaine de la boutique en production. Codé ici EN PLUS de FRONTEND_URL :
     l'oubli de cette variable sur l'hébergeur ne doit pas couper les prix pour
     les clients. Une origine en dur n'affaiblit pas la protection — elle
     désigne une boutique précise, pas un motif ouvert comme `*`. */
  const BOUTIQUE_PROD = 'https://massacre-officiel.com';
  if (!allowedOrigins.includes(BOUTIQUE_PROD)) {
    allowedOrigins.push(BOUTIQUE_PROD, 'https://www.massacre-officiel.com');
  }
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
      // *.shopifypreview.com : liens d'aperçu de thème partagés par Shopify.
      return (
        protocol === 'https:' &&
        (hostname.endsWith('.myshopify.com') || hostname.endsWith('.shopifypreview.com'))
      );
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
      // Lu par le thème pour patienter avant de réessayer après un 429.
      exposedHeaders: ['Retry-After'],
    });
  });

  /* Les parseurs passent APRÈS le CORS : enregistrés avant, un corps trop
     gros (413) ou un JSON invalide répondait SANS en-tête CORS — le navigateur
     n'y voyait qu'un « Failed to fetch », impossible à distinguer d'une panne.
     Le gestionnaire ci-dessous renvoie ces erreurs en JSON, en français. */
  // Augmente la taille max du body JSON/urlencoded.
  // Les devis "coins" embarquent 3 apercus (recto/verso/cote) en base64,
  // ce qui depasse largement la limite Express par defaut (100 kb) -> erreur 413.
  // `verify` conserve le corps BRUT (req.rawBody) UNIQUEMENT pour les webhooks
  // Shopify, indispensable à la vérification de la signature HMAC.
  /* LIMITE DE TAILLE PAR ROUTE. 25 Mo s'appliquaient PARTOUT — y compris sur
     une 404 ou sur /admin/login — et le corps est lu et décodé AVANT que la
     limite de débit (ThrottlerGuard, un guard Nest) n'intervienne : quelques
     dizaines de requêtes parallèles suffisaient à épuiser la mémoire. Seules
     les routes qui transportent réellement des images en base64 gardent une
     limite large ; `json()` ne relit pas un corps déjà décodé, donc le
     premier parseur qui correspond l'emporte. */
  const LIMITES_CORPS: Array<[string, string]> = [
    ['/api/quotes', '25mb'],   // aperçus des devis (base64)
    ['/api/cart', '10mb'],     // propriétés de personnalisation (aperçus)
    ['/api/export', '10mb'],   // compositions d'aperçus
    ['/api/uploads', '10mb'],  // text-svg ; les fichiers passent par multer
    ['/api/webhooks', '5mb'],  // commandes Shopify volumineuses
  ];
  for (const [prefixe, limit] of LIMITES_CORPS) {
    app.use(
      prefixe,
      json({
        limit,
        verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
          if (prefixe === '/api/webhooks') req.rawBody = Buffer.from(buf);
        },
      }),
    );
  }
  app.use(
    json({
      limit: '1mb',
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
  // Aucun formulaire HTML ne poste de gros volume : 100 ko suffisent.
  app.use(urlencoded({ limit: '100kb', extended: true }));
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ statusCode: 413, message: 'Demande trop volumineuse.' });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ statusCode: 400, message: 'Corps de requête JSON invalide.' });
      return;
    }
    next(err);
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

/* Un échec du démarrage (port déjà pris, base injoignable, configuration
   critique manquante) ARRÊTE le process. Avec le filet unhandledRejection
   ci-dessus, il restait en vie SANS serveur HTTP — timers de synchro et de
   relances actifs — et Docker ne le redémarrait jamais. */
bootstrap().catch((e) => {
  Logger.error(
    `Démarrage impossible : ${e instanceof Error ? e.stack || e.message : String(e)}`,
    'Bootstrap',
  );
  process.exit(1);
});
