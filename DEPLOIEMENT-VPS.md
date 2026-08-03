# Déploiement sur VPS OVH — Correctifs à appliquer

Cible : **VPS Starter (1 vCPU, 2 Go RAM)** — NestJS 10 + TypeORM + MySQL.

Ce document liste les correctifs par ordre d'impact réel. Les priorités 1 et 2
écartent le scénario de crash (502). Les suivantes améliorent la latence et la
robustesse, mais ne sont pas ce qui fait tomber le serveur.

---

## Le problème en une phrase

Cette API a **deux profils de routes opposés**, et c'est ce qui détermine tout :

| Catégorie | Routes | Profil | 100 req simultanées |
|---|---|---|---|
| **I/O-bound** | `/api/pricing`, `/api/cart`, `/api/quotes`, `/api/orders`, `/api/health` | Node attend MySQL/réseau, CPU quasi nul | ✅ Sans problème |
| **CPU/RAM-bound** | `/api/uploads` (`sharp`), compositions produit, export ZIP (`jszip`) | Sature le CPU, consomme beaucoup de RAM | ❌ Risque d'OOM kill |

Sur les routes I/O, le risque est une **latence en escalier → 504**.
Sur les routes image, le risque est la **mort du process → 502**.

La limite réelle du VPS n'est **pas le CPU, c'est la RAM**.

---

## Priorité 1 — Créer un swap (5 min)

**Pourquoi :** sur un VPS 2 Go sans swap, le moindre pic mémoire déclenche
l'OOM killer Linux, qui tue le process Node. C'est l'origine des 502.
C'est la protection la plus rentable du document.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Sur un VPS, limiter le recours au swap tant que la RAM suffit
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
```

Vérification : `free -h` doit afficher 2 Go de swap.

> Le swap est un **filet de sécurité**, pas une solution de performance.
> Il évite le crash ; il ne rend pas les uploads plus rapides.

---

## Priorité 2 — Brider `sharp` (le correctif décisif)

**Pourquoi :** `sharp` (libvips) utilise un thread pool natif dimensionné sur le
nombre de cœurs, plus un cache mémoire interne. Sur 1 vCPU, ces deux mécanismes
ne servent à rien et consomment de la RAM pour rien.

Chaque composition dans `composeViewBuffer` enchaîne : resize 1500px →
`metadata()` → resize + `metadata()` **par logo** → `composite().png()`.
Un PNG 1500px décompressé en mémoire, c'est ~9 Mo. Sans limite, 20 à 30 uploads
simultanés suffisent à dépasser 2 Go.

### 2a. Configuration globale de sharp

Dans `src/shared/cloudinary.service.ts`, juste après les imports :

```ts
import sharp from 'sharp';

// VPS 1 vCPU : libvips ne doit pas ouvrir plusieurs threads pour rien,
// et son cache interne est du poids mort quand la RAM est la ressource rare.
sharp.concurrency(1);
sharp.cache(false);
```

### 2b. Limiter le nombre de compositions simultanées

Sans cette borne, le swap seul ne suffira pas : les requêtes continuent
d'arriver et d'allouer. Mieux vaut faire attendre 3 secondes que crasher.

Créer `src/shared/image-semaphore.ts` :

```ts
/**
 * Sémaphore : borne le nombre de traitements sharp simultanés.
 *
 * Sur 1 vCPU, au-delà de 2 tâches concurrentes on n'accélère rien (le cœur est
 * déjà saturé) mais on multiplie les buffers en RAM -> OOM kill. Les requêtes
 * excédentaires attendent leur tour au lieu d'allouer.
 */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  private async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  /** Exécute `fn` en garantissant qu'au plus `max` tâches tournent ensemble. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Une seule instance partagée par tout le process.
export const imageSemaphore = new Semaphore(2);
```

Puis, dans `cloudinary.service.ts`, envelopper chaque méthode publique qui
déclenche du sharp — `uploadLogo`, `uploadPreview`, et les méthodes de
composition :

```ts
import { imageSemaphore } from './image-semaphore';

async uploadLogo(
  fileBuffer: Buffer,
  productType = 'generic',
  placement = 'front',
): Promise<UploadResult> {
  return imageSemaphore.run(async () => {
    const optimized = await sharp(fileBuffer)
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .png({ quality: 90 })
      .toBuffer();

    return this.uploadImage(optimized, {
      folder: `customizer/logos/${productType}`,
      public_id: `logo_${placement}_${Date.now()}`,
    });
  });
}
```

> **Important :** envelopper les méthodes **publiques**, pas les helpers privés
> comme `composeViewBuffer`. Si une méthode publique déjà sous sémaphore appelle
> un helper lui aussi sous sémaphore, le process se bloque (interblocage : la
> tâche attend un slot qu'elle détient elle-même).

---

## Priorité 3 — Limiter les uploads en amont

**Pourquoi :** `src/uploads/uploads.module.ts` utilise `storage: undefined`,
donc **tout fichier reçu passe intégralement en RAM**. `MAX_FILE_SIZE` est bien
lu dans `uploads.controller.ts`, mais la vérification se fait *après* que le
fichier soit déjà en mémoire. Multer n'a aucune limite configurée : un fichier
de 200 Mo est entièrement chargé avant d'être rejeté.

Dans `src/uploads/uploads.module.ts` :

```ts
MulterModule.register({
  storage: undefined,
  limits: {
    // Refus AVANT chargement complet en RAM (la vérif du controller
    // n'intervient qu'une fois le buffer déjà alloué).
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10),
    files: parseInt(process.env.MAX_FILES || '10', 10),
  },
}),
```

À vérifier aussi : `main.ts` fixe `json({ limit: '25mb' })` pour les devis
« coins » en base64. C'est justifié par le besoin métier, mais garde en tête que
chaque requête de ce type peut mobiliser 25 Mo. Le rate limiting (priorité 5)
est ce qui protège réellement contre l'accumulation.

---

## Priorité 4 — Configurer le pool de connexions MySQL

**Pourquoi :** `src/app.module.ts` ne définit aucun paramètre de pool.
`mysql2` applique donc son défaut : `connectionLimit: 10`. Avec 100 requêtes,
90 attendent un slot — ce n'est pas un crash, c'est de la latence cumulative.
Si une requête prend 200 ms, la 90ᵉ attend 1,8 s et le proxy renvoie un 504.

Dans `TypeOrmModule.forRootAsync`, ajouter au `useFactory` :

```ts
extra: {
  // MySQL sur le même vCPU : au-delà de ~15, on ajoute de la contention,
  // pas du débit. Augmenter ce chiffre ne rend PAS l'API plus rapide.
  connectionLimit: 15,
  connectTimeout: 10000,
},
```

> **Contre-intuitif mais essentiel :** augmenter le pool n'augmente pas la
> capacité quand MySQL partage le vCPU. Le goulot est le CPU de la base, pas le
> nombre de connexions.

**Si MySQL est hébergé ailleurs** (base managée), cette contrainte disparaît :
tu récupères ~400 Mo de RAM et tu peux monter `connectionLimit` à 25-30.

---

## Priorité 5 — Reverse proxy Nginx

**Pourquoi :** avec un seul process Node, un reverse proxy ne « répartit » rien.
Son intérêt réel est ailleurs :

- **TLS terminé hors de Node** — gain CPU mesurable
- **Buffering des requêtes lentes** — protège Node des clients à connexion lente sur les uploads
- **Timeouts explicites** — un 504 propre plutôt qu'une connexion pendante
- **Rate limiting** — la vraie protection contre le pic sur `/api/uploads`

```nginx
limit_req_zone $binary_remote_addr zone=uploads:10m rate=2r/s;
limit_req_zone $binary_remote_addr zone=api:10m rate=20r/s;

server {
    listen 443 ssl http2;
    server_name api.mon-domaine.fr;

    # --- Uploads : lents et gourmands, à brider en priorité ---
    location /api/uploads {
        limit_req zone=uploads burst=5 nodelay;
        client_max_body_size 25m;
        proxy_read_timeout 120s;   # composition d'images = lent par nature
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # --- Reste de l'API ---
    location /api {
        limit_req zone=api burst=40 nodelay;
        client_max_body_size 25m;   # devis "coins" en base64
        proxy_read_timeout 60s;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> **Caddy** est une alternative valable si tu veux le HTTPS automatique sans
> gérer Certbot. La configuration équivalente tient en 10 lignes.

---

## Priorité 6 — Cache sur `/api/pricing`

**Pourquoi :** les tarifs changent rarement et cette route est la plus appelée.
Un cache mémoire supprime l'essentiel de la charge MySQL.

```bash
npm install @nestjs/cache-manager cache-manager
```

Dans `app.module.ts` :

```ts
import { CacheModule } from '@nestjs/cache-manager';

imports: [
  CacheModule.register({ isGlobal: true, ttl: 60_000, max: 200 }),
  // ...
]
```

Puis sur `pricing.controller.ts` :

```ts
import { CacheInterceptor } from '@nestjs/cache-manager';
import { UseInterceptors } from '@nestjs/common';

@Controller('pricing')
@UseInterceptors(CacheInterceptor)
export class PricingController { /* ... */ }
```

> **N'installe pas Redis.** Sur 2 Go, un service supplémentaire consomme de la
> RAM — la ressource critique — pour un gain nul à cette échelle. Le cache
> mémoire suffit tant qu'il n'y a qu'un seul process Node.

---

## Priorité 7 — Process manager (PM2)

**Pourquoi :** redémarrage automatique après un crash ou un reboot du VPS.

```bash
npm install -g pm2
pm2 start dist/main.js --name customizer-api \
  --max-memory-restart 900M \
  --node-args="--max-old-space-size=768"
pm2 save
pm2 startup   # exécuter la commande affichée
```

- `--max-memory-restart 900M` : redémarrage propre **avant** que l'OOM killer
  n'intervienne. Un redémarrage contrôlé vaut mieux qu'un `SIGKILL`.
- `--max-old-space-size=768` : borne le heap V8. Sans ça, Node peut viser une
  limite calculée sur la RAM totale et entrer en concurrence avec MySQL.

> **Ne pas utiliser le mode cluster** (`-i max`). Sur 1 vCPU, plusieurs process
> se disputent le même cœur et **multiplient la RAM consommée** — exactement le
> contraire de ce qu'on cherche.

---

## Correctifs de sécurité (hors charge, mais partent en production)

Ces deux points ne concernent pas la performance, mais ils accompagnent la mise
en production.

### CORS ouvert à toutes les origines

Dans `main.ts`, la branche `else` du callback fait `callback(null, true)` :
toutes les origines sont acceptées. Le commentaire du code le signale déjà
(« à durcir en prod »).

```ts
app.enableCors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.myshopify.com')) {
      callback(null, true);
    } else {
      callback(new Error('Origine non autorisée'), false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  credentials: true,
});
```

> Vérifie que `FRONTEND_URL` est correctement renseignée sur le VPS **avant**
> d'appliquer ce durcissement, sinon le configurateur se retrouve bloqué.

### `synchronize` TypeORM

La configuration actuelle est déjà correcte (opt-in explicite via
`DB_SYNCHRONIZE === 'true'`, plutôt qu'un test sur `NODE_ENV`). Le commentaire
du code explique bien le risque.

**Action :** s'assurer simplement que `DB_SYNCHRONIZE` n'est **pas défini** dans
le `.env` du VPS. Cette variable active des `ALTER`/`DROP` automatiques qui
peuvent détruire des colonnes et leurs données sans confirmation.

---

## Checklist de déploiement

```
[ ] 1. Swap 2 Go activé + swappiness=10        (empêche l'OOM kill)
[ ] 2. sharp.concurrency(1) + sharp.cache(false)
[ ] 3. Sémaphore images (max 2 simultanées)
[ ] 4. Limites Multer (fileSize / files)
[ ] 5. Pool TypeORM (connectionLimit: 15)
[ ] 6. Nginx : TLS, timeouts, rate limiting
[ ] 7. Cache 60s sur /api/pricing
[ ] 8. PM2 avec --max-memory-restart 900M
[ ] 9. CORS durci (après vérif de FRONTEND_URL)
[ ] 10. DB_SYNCHRONIZE absent du .env de production
```

**Si tu ne fais que deux choses : les points 1 et 2.**
C'est 15 minutes de travail et cela écarte le scénario de crash. Le reste est
du confort par comparaison.

---

## Vérifier que ça tient

Test de charge avec `autocannon` (à lancer depuis ta machine, pas depuis le VPS —
sinon l'outil consomme le CPU qu'il est censé mesurer) :

```bash
npx autocannon -c 100 -d 30 https://api.mon-domaine.fr/api/pricing
```

Attendu sur la route pricing : **aucune erreur**, p99 sous 200 ms.

Pendant ce temps, surveiller sur le VPS :

```bash
pm2 monit          # RAM et CPU du process Node
free -h            # RAM totale + usage swap
```

Ne teste pas `/api/uploads` à 100 connexions concurrentes : le sémaphore va
sérialiser les requêtes et tu mesureras la file d'attente, pas la capacité.
Pour cette route, teste à 5-10 connexions et vérifie surtout que **la RAM se
stabilise** au lieu de croître continûment.

---

## Ordre de grandeur attendu après correctifs

| Scénario | CPU | RAM | Latence | Résultat |
|---|---|---|---|---|
| 100 req/s sur `/api/pricing` (avec cache) | 30-50 % | ~600 Mo | p99 < 100 ms | ✅ |
| 100 req/s sur `/api/pricing` (sans cache) | 60-80 % | ~700 Mo | p99 ~300 ms | ✅ |
| 20 uploads simultanés | 100 % | ~1,2 Go | 3-10 s (file d'attente) | ✅ dégradé mais stable |
| 100 uploads simultanés | 100 % | ~1,5 Go + swap | 30 s+ | ⚠️ lent, mais **pas de crash** |

Sans les priorités 1 et 2, ce dernier scénario se termine par un OOM kill et une
série de 502.

---

## Une note d'honnêteté sur le dimensionnement

100 requêtes **réellement simultanées** est un scénario rare pour un
configurateur Shopify : la charge est étalée dans le temps et les visiteurs
passent l'essentiel de leur session à manipuler l'interface, pas à appeler l'API.

Le VPS Starter tient largement le trafic réel. Ce document existe pour que le
jour où un pic arrive, il se traduise par des requêtes **lentes** plutôt que par
un serveur **mort**.

Le signal qui doit déclencher un passage au palier supérieur (2 vCPU / 4 Go)
n'est pas le nombre de visiteurs, mais la RAM : si `free -h` montre un usage
soutenu du swap en fonctionnement normal, le VPS est à sa limite.
