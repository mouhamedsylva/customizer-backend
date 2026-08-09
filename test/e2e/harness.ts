import { Test } from '@nestjs/testing';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { DataSource, getMetadataArgsStorage } from 'typeorm';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { AppModule } from '../../src/app.module';
import { ShopifyService } from '../../src/shared/shopify.service';
import { CloudinaryService } from '../../src/shared/cloudinary.service';
import { AdminAuthService } from '../../src/admin/admin-auth.service';

/**
 * Harnais end-to-end : l'application RÉELLE, sans service externe.
 *
 * Ce qui est réel — donc réellement testé :
 *   contrôleurs, pipes de validation, guards, limiteur de débit, sérialisation,
 *   services métier, requêtes TypeORM, entités et contraintes de schéma.
 *
 * Ce qui est remplacé :
 *   - MySQL   -> SQLite en mémoire, recréée à chaque suite (aucun fichier,
 *                aucune trace, et la base Railway n'est jamais contactée) ;
 *   - Shopify -> doublure locale ; sans elle, chaque exécution créerait de
 *                VRAIES commandes dans la boutique de production ;
 *   - Cloudinary -> doublure ; sinon chaque test laisserait un média facturé.
 *
 * Les doublures enregistrent leurs appels : on vérifie ainsi non seulement la
 * réponse HTTP, mais aussi que le bon appel externe a été émis avec les bons
 * arguments — ce qu'un test de façade ne voit pas.
 */

/** Types MySQL absents de SQLite. Adaptation de SCHÉMA uniquement. */
const REMAP: Record<string, string> = {
  char: 'varchar',
  longtext: 'text',
  mediumtext: 'text',
  tinytext: 'text',
  decimal: 'real',
  double: 'real',
  timestamp: 'datetime',
  json: 'simple-json',
};

let remapped = false;
function remapColumnsOnce(): void {
  if (remapped) return;
  for (const col of getMetadataArgsStorage().columns) {
    const t = col.options?.type;
    if (typeof t === 'string' && REMAP[t]) col.options.type = REMAP[t];
    if (col.options) {
      delete col.options.width;
      delete col.options.unsigned;
    }
  }
  remapped = true;
}

/**
 * Redirige TypeORM de MySQL vers SQLite en mémoire.
 *
 * `AppModule` construit sa configuration via `forRootAsync` en lisant
 * `MYSQL_URL` : on ne peut pas la surcharger par injection sans réécrire le
 * module. On intercepte donc `DataSource.initialize`, juste avant la connexion.
 *
 * Sans cela, chaque test tentait de joindre un vrai MySQL et échouait en
 * `ECONNREFUSED` — un diagnostic opaque (`AggregateError` sans message) qui ne
 * désigne pas sa cause.
 */
let patched = false;
function patchDataSourceOnce(): void {
  if (patched) return;
  patched = true;

  const proto = DataSource.prototype as unknown as {
    initialize: (...a: unknown[]) => Promise<DataSource>;
  };
  const original = proto.initialize;

  proto.initialize = function (this: DataSource, ...args: unknown[]) {
    if (this.options?.type === 'mysql') {
      remapColumnsOnce();
      Object.defineProperty(this, 'options', {
        value: {
          type: 'sqljs',
          location: undefined, // pure mémoire : aucun fichier écrit
          autoSave: false,
          entities: this.options.entities,
          synchronize: true, // crée le schéma dans une base vide
          logging: false,
        },
        writable: true,
        configurable: true,
      });
      // Le driver est instancié depuis `options.type` : il faut le reconstruire.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { DriverFactory } = require('typeorm/driver/DriverFactory');
      (this as unknown as { driver: unknown }).driver = new DriverFactory().create(
        this,
      );
    }
    return original.apply(this, args);
  };
}

/** Appel enregistré par une doublure. */
export interface Call {
  method: string;
  args: unknown[];
}

/** Doublure Shopify : mémorise les appels et rejoue des réponses plausibles. */
export class FakeShopify {
  calls: Call[] = [];
  /** Erreur à lever au prochain appel de la méthode nommée. */
  failNext = new Map<string, Error>();

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
    const err = this.failNext.get(method);
    if (err) {
      this.failNext.delete(method);
      throw err;
    }
  }

  /** Appels enregistrés pour une méthode donnée. */
  callsTo(method: string): Call[] {
    return this.calls.filter((c) => c.method === method);
  }

  reset(): void {
    this.calls = [];
    this.failNext.clear();
  }

  async createDraftOrder(payload: unknown): Promise<Record<string, unknown>> {
    this.record('createDraftOrder', [payload]);
    return { id: 999001, status: 'open', total_price: '0.00', line_items: [] };
  }

  async getDraftOrder(id: unknown): Promise<Record<string, unknown>> {
    this.record('getDraftOrder', [id]);
    return {
      id,
      status: 'open',
      total_price: '42.00',
      invoice_url: 'https://boutique-test.myshopify.com/invoice/abc',
      line_items: [{ id: 1, variant_id: 42, quantity: 2, properties: [] }],
    };
  }

  async updateDraftOrderLineItems(id: unknown, items: unknown) {
    this.record('updateDraftOrderLineItems', [id, items]);
    return { id, line_items: items };
  }

  async setDraftOrderPrice(id: unknown, price: unknown) {
    this.record('setDraftOrderPrice', [id, price]);
    return { id, total_price: String(price) };
  }

  async sendDraftOrderInvoice(id: unknown, message?: unknown) {
    this.record('sendDraftOrderInvoice', [id, message]);
    return { id, status: 'invoice_sent' };
  }

  async deleteDraftOrderLine(id: unknown, lineId: unknown) {
    this.record('deleteDraftOrderLine', [id, lineId]);
    return { id, line_items: [] };
  }

  async getShippingState(id: unknown): Promise<string> {
    this.record('getShippingState', [id]);
    return 'unfulfilled';
  }

  async markInProgress(id: unknown) {
    this.record('markInProgress', [id]);
    return { ok: true };
  }

  async fulfillOrder(id: unknown, opts: unknown) {
    this.record('fulfillOrder', [id, opts]);
    return { ok: true };
  }

  async updateProductPrice(productId: unknown, price: unknown) {
    this.record('updateProductPrice', [productId, price]);
    return { ok: true };
  }

  async getProductVariants(productId: unknown) {
    this.record('getProductVariants', [productId]);
    return { title: 'Produit test', variants: [{ id: 1, price: '10.00' }] };
  }

  async listOrders() {
    this.record('listOrders', []);
    return { orders: [], nextPageInfo: null };
  }

  async listDraftOrders(limit?: unknown) {
    this.record('listDraftOrders', [limit]);
    return [];
  }

  async getOrder(id: unknown) {
    this.record('getOrder', [id]);
    return { id, name: '#1001', line_items: [] };
  }
}

/** Doublure Cloudinary : aucun média n'est envoyé ni facturé. */
export class FakeCloudinary {
  calls: Call[] = [];

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
  }

  callsTo(method: string): Call[] {
    return this.calls.filter((c) => c.method === method);
  }

  reset(): void {
    this.calls = [];
  }

  // Noms alignés sur le service réel (src/shared/cloudinary.service.ts) : une
  // doublure qui invente ses méthodes ne remplace rien — l'appel réel partirait
  // vers Cloudinary, ou échouerait sur une méthode absente.
  async uploadLogo(...args: unknown[]) {
    this.record('uploadLogo', args);
    return {
      secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/logo.png',
      public_id: 'test/logo123',
    };
  }

  async uploadPreview(...args: unknown[]) {
    this.record('uploadPreview', args);
    return {
      secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/preview.png',
      public_id: 'test/preview123',
    };
  }

  async composeAndUploadPreview(...args: unknown[]) {
    this.record('composeAndUploadPreview', args);
    return {
      secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/compose.png',
      public_id: 'test/compose123',
    };
  }

  async composeMultiViewAndUpload(...args: unknown[]) {
    this.record('composeMultiViewAndUpload', args);
    return [
      {
        view: 'face',
        secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/face.png',
        public_id: 'test/face',
      },
    ];
  }

  async deleteImage(publicId: unknown) {
    this.record('deleteImage', [publicId]);
    return true;
  }
}

export interface Harness {
  app: INestApplication;
  shopify: FakeShopify;
  cloudinary: FakeCloudinary;
  /** Vide toutes les tables : isole chaque test sans relancer l'application. */
  resetDb: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Démarre l'application de test.
 *
 * Les variables d'environnement sont posées AVANT la construction du module :
 * les identifiants externes sont vidés, de sorte qu'un appel réseau resterait
 * impossible même si une doublure était oubliée.
 */
export async function createHarness(): Promise<Harness> {
  process.env.NODE_ENV = 'test';
  process.env.SHOPIFY_ACCESS_TOKEN = '';
  process.env.SHOPIFY_STORE_URL = 'boutique-test.myshopify.com';
  process.env.SHOPIFY_WEBHOOK_SECRET = 'secret-webhook-de-test';
  process.env.CLOUDINARY_CLOUD_NAME = '';
  process.env.CLOUDINARY_API_KEY = '';
  process.env.CLOUDINARY_API_SECRET = '';
  process.env.ADMIN_SESSION_SECRET = 'a'.repeat(48);
  process.env.CART_TOKEN_SECRET = 'b'.repeat(48);
  process.env.ADMIN_SEED_EMAIL = 'patron@test.fr';
  process.env.ADMIN_SEED_PASSWORD = 'MotDePasseTest123';
  process.env.FRONTEND_URL = 'https://boutique-test.fr';
  delete process.env.MYSQL_URL;
  delete process.env.DATABASE_URL;

  // AVANT la construction du module : c'est lui qui déclenche la connexion.
  patchDataSourceOnce();

  const shopify = new FakeShopify();
  const cloudinary = new FakeCloudinary();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ShopifyService)
    .useValue(shopify)
    .overrideProvider(CloudinaryService)
    .useValue(cloudinary)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });

  /*
   * Réplique du pipeline de `main.ts`.
   *
   * `verify` conserve le corps BRUT des webhooks : la signature HMAC de
   * Shopify porte sur les octets reçus, pas sur l'objet reparsé. Sans ce
   * middleware, `req.rawBody` est absent et TOUTE signature — même
   * parfaitement valide — est rejetée. Le test aurait alors « prouvé » que la
   * vérification fonctionne, alors qu'elle refusait simplement tout.
   *
   * Le test porte sur le CHEMIN SEUL et il est ancré : `includes()` sur l'URL
   * complète ferait copier le corps sur n'importe quelle route via la query.
   */
  app.use(
    json({
      limit: '25mb',
      verify: (req: { originalUrl?: string; rawBody?: Buffer }, _res, buf: Buffer) => {
        const path = (req.originalUrl || '').split('?')[0];
        if (path.startsWith('/api/webhooks/')) {
          req.rawBody = Buffer.from(buf);
        }
      },
    }),
  );
  app.use(urlencoded({ limit: '25mb', extended: true }));
  app.use(cookieParser());
  // Réplique de main.ts : `trust proxy` conditionne la clé du limiteur, et le
  // préfixe global conditionne toutes les URL testées.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();

  const ds = app.get(DataSource);

  return {
    app,
    shopify,
    cloudinary,
    resetDb: async () => {
      // `synchronize` recrée le schéma vide : plus simple et plus sûr qu'un
      // TRUNCATE table par table, qui oublierait toute entité ajoutée plus tard.
      await ds.synchronize(true);
      // Le compte propriétaire est créé par `onModuleInit`, donc AVANT ce
      // nettoyage : sans ce rappel, la table `admins` repart vide et toute
      // tentative de connexion échoue en 401 — un échec qui ferait croire à un
      // bug d'authentification alors que le compte n'existe simplement plus.
      await app.get(AdminAuthService).onModuleInit();
      shopify.reset();
      cloudinary.reset();
    },
    close: async () => {
      await app.close();
    },
  };
}

/**
 * IP unique par requête, pour neutraliser le limiteur (120 req/min par IP).
 *
 * `trust proxy = 1` fait lire la dernière adresse de `X-Forwarded-For`. Sans
 * cela, une suite de plus de 120 requêtes verrait ses derniers tests échouer
 * en 429 — un échec qui n'aurait rien à voir avec le code testé.
 */
let ipSeq = 0;
export function freshIp(): string {
  const i = ipSeq++;
  return `10.${Math.floor(i / 64516) % 254}.${Math.floor(i / 254) % 254}.${(i % 254) + 1}`;
}
