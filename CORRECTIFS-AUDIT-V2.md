# Correctifs à appliquer — issus de l'audit v2 (contre-expertise)

**Date :** 2026-08-05
**Source :** contre-expertise de l'audit initial, avec vérification empirique
**Périmètre :** uniquement les problèmes **confirmés par test ou lecture directe**

Ce document ne reprend pas l'audit v1 (`AUDIT-PRODUCTION.md`). Il liste ce qui reste à
corriger après remise en cause, dans l'ordre où il faut le faire.

> **Changement d'ordre par rapport à la v1 :** la RAM passe devant la sécurité. Un OOM
> kill tue le process — tous les autres correctifs deviennent alors sans objet.

---

## Récapitulatif

| # | Problème | Gravité | Effort |
|---|---|---|---|
| **VAGUE 0 — empêcher le crash** ||||
| 0.1 | `sharp` non bridé (concurrency 8 sur 1 vCPU) | 🔴 | 5 min |
| 0.2 | Aucun sémaphore sur les traitements image | 🔴 | 30 min |
| 0.3 | Aucune limite RAM Docker | 🔴 | 10 min |
| 0.4 | Swap absent du VPS | 🔴 | 5 min (hors dépôt) |
| **VAGUE 1 — sécurité bloquante** ||||
| 1.1 | `SHOPIFY_WEBHOOK_SECRET` absent du `.env` | 🔴 | 15 min |
| 1.2 | CSRF : cookie `sameSite: 'lax'` | 🔴 | 5 min |
| 1.3 | CORS ouvert à tout `*.myshopify.com` | 🔴 | 20 min |
| 1.4 | `ADMIN_PASSWORD` comme secret HMAC | 🟠 | 10 min |
| 1.5 | Injection de formules CSV | 🟠 | 15 min |
| 1.6 | Stack trace renvoyée au client | 🟠 | 10 min |
| 1.7 | `GET /api/health/variants` public | 🟡 | 10 min |
| 1.8 | Endpoints image publics non bornés | 🟠 | 45 min |
| **VAGUE 2 — fiabilité** ||||
| 2.1 | Double e-mail (race webhook/synchro) | 🟠 | 1 h |
| 2.2 | Seed admin silencieusement avalé | 🟠 | 30 min |
| 2.3 | Pool MySQL non configuré | 🟡 | 5 min |
| 2.4 | `buildAndSendZip` sans timeout ni bornes | 🟠 | 1 h |
| 2.5 | Zéro test automatisé | 🟠 | 1 j |
| 2.6 | `synchronize` au lieu de migrations | 🟠 | 0,5 j |
| **VAGUE 3 — dette** ||||
| 3.1 | Dépendances vulnérables (1 `high`) | 🔴 | 0,5 j |
| 3.2 | Pas de jetons CSRF | 🟠 | 0,5 j |
| 3.3 | CSP désactivée globalement | 🟡 | 1 j |
| 3.4 | Divers (SVG, rétention, ESLint, N+1…) | 🟡 | 1 j |

---

# VAGUE 0 — Empêcher le crash

> Contexte : la cible est un **VPS 1 vCPU / 2 Go RAM** hébergeant Node **et** MySQL 8.4
> (source : `DEPLOIEMENT-VPS.md`). MySQL réclame déjà ~400 Mo. J'ai mesuré qu'un buffer
> RGBA 1500×2000 — le format produit par `composeViewBuffer` — pèse **11,4 Mo** en
> mémoire décompressée.

## 0.1 — `sharp` n'est pas bridé 🔴

**Fichier :** [src/shared/cloudinary.service.ts](src/shared/cloudinary.service.ts)

**Constat mesuré sur cette machine :**
```
sharp concurrency par défaut : 8
sharp cache par défaut       : { memory: { max: 50 Mo }, files: 20, items: 100 }
```

Sur 1 vCPU, 8 threads libvips ne font rien gagner (le cœur est déjà saturé) mais
multiplient les buffers en RAM. Le cache de 50 Mo est du poids mort quand la RAM est la
ressource rare.

**Correctif** — après les imports, avant `@Injectable()` :

```ts
import sharp from 'sharp';

// VPS 1 vCPU : libvips ne doit pas ouvrir plusieurs threads pour rien, et son
// cache interne est du poids mort quand la RAM est la ressource critique.
sharp.concurrency(1);
sharp.cache(false);
```

**Vérification :** `node -e "const s=require('sharp'); console.log(s.concurrency())"` → `1`.

---

## 0.2 — Aucun sémaphore sur les traitements image 🔴

**Fichiers :** nouveau `src/shared/image-semaphore.ts`, puis [src/shared/cloudinary.service.ts](src/shared/cloudinary.service.ts)

Sans borne, les requêtes continuent d'arriver et d'allouer. `sharp.concurrency(1)` seul ne
suffit pas : il limite les threads *internes* à libvips, pas le nombre de compositions
Node simultanées. Mieux vaut faire attendre 3 secondes que crasher.

Les endpoints concernés sont **publics** : `POST /api/uploads/logo`,
`POST /api/uploads/preview`, `POST /api/export/preview-image`,
`POST /api/export/preview-multi`.

**Correctif :** le code est fourni clé en main dans `DEPLOIEMENT-VPS.md` (priorité 2b).
Créer `src/shared/image-semaphore.ts` avec la classe `Semaphore` et l'instance partagée
`export const imageSemaphore = new Semaphore(2)`.

Puis envelopper les **méthodes publiques** de `CloudinaryService` :

| Ligne | Méthode | À envelopper |
|---|---|---|
| 120 | `uploadLogo` | ✅ |
| 139 | `uploadPreview` | ✅ |
| 319 | `composeAndUploadPreview` | ✅ |
| 336 | `composeMultiViewAndUpload` | ✅ |
| 258 | `composeViewBuffer` | ❌ **NON** — helper privé |

> ⚠️ **Interblocage.** `composeAndUploadPreview` et `composeMultiViewAndUpload` appellent
> `composeViewBuffer`. Si le helper était aussi sous sémaphore, la tâche attendrait un
> slot qu'elle détient déjà → blocage définitif du process. N'envelopper que les méthodes
> publiques.

**Vérification :** lancer 10 uploads concurrents, surveiller que la RAM se stabilise au
lieu de croître (`docker stats`).

---

## 0.3 — Aucune limite RAM sur les conteneurs 🔴

**Fichier :** [docker-compose.yml](docker-compose.yml)

Vérifié : aucun `mem_limit`, `cpus` ni section `deploy.resources`. Sur 2 Go partagés, un
pic sur l'API peut déclencher l'OOM killer Linux, qui tue arbitrairement — potentiellement
MySQL plutôt que Node.

**Correctif :**

```yaml
services:
  api:
    mem_limit: 1g
    mem_reservation: 512m
    environment:
      # Borne le heap V8 : sans ça Node vise une limite calculée sur la RAM
      # totale de l'hôte et entre en concurrence avec MySQL.
      NODE_OPTIONS: "--max-old-space-size=768"

  db:
    mem_limit: 700m
    command: >
      --innodb-buffer-pool-size=256M
      --performance-schema=OFF
```

> `performance_schema` consomme ~200 Mo pour rien sur une base de cette taille.

---

## 0.4 — Swap absent du VPS 🔴 *(hors dépôt)*

Sur un VPS 2 Go sans swap, le moindre pic déclenche l'OOM killer. Commandes dans
`DEPLOIEMENT-VPS.md` (priorité 1) : `fallocate` 2 Go + `swappiness=10`.

**Vérification :** `free -h` doit afficher 2 Go de swap.

---

# VAGUE 1 — Sécurité bloquante

## 1.1 — `SHOPIFY_WEBHOOK_SECRET` absent du `.env` 🔴

**Fichiers :** `.env`, [src/webhooks/webhooks.service.ts:105-118](src/webhooks/webhooks.service.ts#L105-L118)

Le code rejette — à raison — tout webhook sans secret. Mais le `.env` présent ne définit
**ni** `SHOPIFY_WEBHOOK_SECRET`, **ni** `ADMIN_SESSION_SECRET`, **ni** `DB_SYNCHRONIZE`,
**ni** `ADMIN_SEED_*`, **ni** `BACKEND_URL`. Il correspond à l'ancien `.env.example`.

Aggravant : `DEPLOIEMENT-VPS.md` ne mentionne jamais cette variable — le risque d'oubli au
déploiement est réel.

**Conséquence :** `401` systématique sur les webhooks → Shopify les désactive → les
commandes ne remontent plus en temps réel. Seul filet restant : la synchro toutes les
2 min, qui exige le scope `read_orders`.

**Correctif :** reconstruire le `.env` de production à partir de `.env.production.example`
et renseigner `SHOPIFY_WEBHOOK_SECRET` (Shopify → Paramètres → Notifications → Webhooks).

**Vérification :** passer une commande de test, confirmer un `200` dans les logs, pas
un `401`.

---

## 1.2 — CSRF : cookie en `sameSite: 'lax'` 🔴

**Fichier :** [src/admin/admin.controller.ts:133-138](src/admin/admin.controller.ts#L133-L138)

**Preuve obtenue par test** avec les vrais paquets `cors@2.8.5` / `express@4.22.1`,
reproduisant la logique exacte de `main.ts` :

```
Attaquant *.myshopify.com  HTTP 200 | ACAO=https://attaquant-evil.myshopify.com | ACAC=true
Externe quelconque         HTTP 200 | ACAO=null | body={"EFFET":"PRIX_MODIFIE_COTE_SERVEUR"}
```

**Le refus CORS n'empêche pas l'exécution.** Le middleware `cors` appelle `next()` même
sur une origine refusée : la route s'exécute, l'effet de bord est produit, seule la
*lecture* de la réponse est bloquée. Pour un CSRF, la lecture est sans importance.

**Second vecteur, confirmé par test :** `main.ts:38` active `urlencoded`, et les routes
admin lisent `@Body('status')` sans exiger `Content-Type: application/json` :

```
FORM urlencoded -> {"recu_status":"shipped","recu_tracking":"XYZ"}
```

Un `<form method="POST">` cross-site atteint donc les routes admin **sans preflight**.

**Actions atteignables :** `POST /api/admin/pricing` (prix répercutés sur Shopify),
`quotes/:id/invoice`, `orders/:id/status` avec `shipped` (**déclenche l'e-mail client
réel**), `POST /api/admin/admins`.

**Correctif :**

```ts
res.cookie(this.auth.cookieName, this.auth.issueToken(admin.id), {
  httpOnly: true,
  sameSite: 'strict',   // 'lax' laissait passer le vecteur formulaire
  secure: true,
  maxAge: 1000 * 60 * 60 * 12,
});
```

Le dashboard est servi par la même origine (`GET /api/admin`) : aucune navigation
cross-site légitime n'a besoin du cookie. `strict` ne casse rien.

---

## 1.3 — CORS ouvert à tout `*.myshopify.com` 🔴

**Fichier :** [src/main.ts:63-70](src/main.ts#L63-L70)

Le contrôle du hostname parsé est bien fait (il bloque `evil-myshopify.com`). Le problème
est ailleurs : **n'importe qui crée une boutique `myshopify.com` gratuitement**, y injecte
du JS via le thème, et dispose d'une origine que ce backend autorise avec
`credentials: true`.

**Correctif :** restreindre à la boutique réelle en production.

```ts
const storeUrl = (config.get<string>('SHOPIFY_STORE_URL') || '').toLowerCase();
const isDev = config.get<string>('NODE_ENV') !== 'production';

const isShopifyOrigin = (origin: string): boolean => {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== 'https:') return false;
    // En production, seule la boutique configurée est autorisée : un
    // sous-domaine .myshopify.com quelconque est créable par n'importe qui.
    if (!isDev) return hostname === storeUrl;
    return hostname.endsWith('.myshopify.com');
  } catch {
    return false;
  }
};
```

> ⚠️ Vérifier que `SHOPIFY_STORE_URL` est correctement renseignée **avant** de déployer,
> sinon le configurateur est bloqué.

---

## 1.4 — `ADMIN_PASSWORD` accepté comme secret HMAC 🟠

**Fichier :** [src/admin/admin-auth.service.ts:209-211](src/admin/admin-auth.service.ts#L209-L211)

```ts
const configured =
  this.config.get<string>('ADMIN_SESSION_SECRET') ||
  this.config.get<string>('ADMIN_PASSWORD');   // <-- vestige
```

`ADMIN_PASSWORD` **n'apparaît dans aucun `.env.example`** — c'est un reliquat de l'ancien
système d'authentification. Si une installation historique la définit encore (un mot de
passe humain, ~40 bits d'entropie), elle devient la clé HMAC des sessions au lieu des
256 bits attendus.

**Impact :** un secret devinable permet de **forger un cookie de session admin valide** —
`parseToken` ne vérifie que la signature et l'expiration, sans état serveur.

**Correctif :** supprimer le repli, et refuser un secret trop court.

```ts
const configured = this.config.get<string>('ADMIN_SESSION_SECRET');
if (configured) {
  if (configured.length < 32) {
    throw new Error(
      'ADMIN_SESSION_SECRET trop court (32 caractères minimum). ' +
        'Générez-le avec : openssl rand -hex 32',
    );
  }
  this.cachedSecret = configured;
  return configured;
}
```

> Si une instance utilise encore `ADMIN_PASSWORD`, ce changement invalide les sessions en
> cours — comportement souhaitable ici.

---

## 1.5 — Injection de formules CSV 🟠

**Fichier :** [src/admin/admin.controller.ts:581](src/admin/admin.controller.ts#L581)

```ts
const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
```

L'échappement des guillemets est correct **pour le format CSV**, mais ne protège pas
contre les formules. Test :

```
q('=HYPERLINK("http://evil","clic")')  ->  "=HYPERLINK(""http://evil"",""clic"")"
```

Excel et LibreOffice interprètent une cellule commençant par `=`, `+`, `-` ou `@` comme
une formule, **y compris entre guillemets CSV**.

**Sources non fiables concernées :** `customerName`, `customerEmail` (saisis au checkout
Shopify), `internalNote`, et tous les champs du formulaire **public** de devis
(`nom`, `entreprise`, `telephone`…).

**Impact :** l'export comptable part chez un tiers. Exfiltration via
`=HYPERLINK`/`WEBSERVICE`, ou exécution DDE selon la configuration du poste.

**Correctif :**

```ts
/**
 * Échappe une valeur pour le CSV.
 *
 * Le doublement des guillemets suffit au FORMAT, mais pas à la SÉCURITÉ : Excel
 * interprète toute cellule commençant par = + - @ (ou une tabulation / un retour
 * chariot) comme une formule, y compris entre guillemets. On préfixe donc d'une
 * apostrophe, qui force le mode texte sans être affichée.
 */
const q = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
```

---

## 1.6 — Stack trace complète renvoyée au client 🟠

**Fichier :** [src/admin/admin.controller.ts:406-412](src/admin/admin.controller.ts#L406-L412)

```ts
res.status(500).type('text').send('ZIP ERROR:\n' + ((err as Error)?.stack || String(err)));
```

Expose les chemins du système de fichiers, la structure interne et les versions de
bibliothèques. Le projet dispose déjà de `throwUpstream()`
([src/shared/upstream-error.ts](src/shared/upstream-error.ts)), écrit pour ce problème et
correctement utilisé dans `CartService` et `OrdersService`.

**Correctif :**

```ts
} catch (err) {
  throwUpstream(this.logger, "Impossible de construire l'archive.", err);
}
```

---

## 1.7 — `GET /api/health/variants` public 🟡

**Fichier :** [src/health/health.controller.ts:37-56](src/health/health.controller.ts#L37-L56)

Expose sans authentification les IDs produits/variants Shopify **et les prix**. Déclenche
5 appels API Shopify par requête — donc utilisable pour épuiser le quota.

Le commentaire indique « À utiliser une fois pour remplir les `window.CONF_VARIANT_*` » :
c'est un outil de mise en place.

**Correctif :** `@UseGuards(AdminSessionGuard)` sur la méthode (importer `AdminModule`
dans `HealthModule`), ou supprimer la route.

---

## 1.8 — Endpoints image publics non bornés 🟠

**Fichiers :** [src/export/dto/preview-multi.dto.ts](src/export/dto/preview-multi.dto.ts),
[src/export/dto/preview-image.dto.ts](src/export/dto/preview-image.dto.ts),
[src/export/export.controller.ts](src/export/export.controller.ts),
[src/quotes/quotes.controller.ts](src/quotes/quotes.controller.ts)

`PreviewMultiDto.views` n'a que `@ArrayNotEmpty()` — **aucune borne supérieure**. Chaque
vue porte un tableau `logos` également non borné. Avec un corps de 25 Mo autorisé, une
seule requête peut demander des centaines de compositions.

Couplé à la vague 0, c'est le vecteur d'OOM le plus direct.

**Correctif :**

```ts
// preview-multi.dto.ts
@IsArray()
@ArrayNotEmpty()
@ArrayMaxSize(6)   // face, dos, 2 manches, 2 réserves : au-delà c'est anormal
@ValidateNested({ each: true })
@Type(() => PreviewViewDto)
views!: PreviewViewDto[];

// preview-image.dto.ts — sur PreviewLogoDto[]
@ArrayMaxSize(10)
logos?: PreviewLogoDto[];
```

Et un plafond dédié sur les routes coûteuses :

```ts
// export.controller.ts — sur previewImage et previewMulti
@Throttle({ default: { limit: 10, ttl: 60000 } })

// quotes.controller.ts — POST /api/quotes crée un draft order + 2 e-mails
@Throttle({ default: { limit: 5, ttl: 60000 } })
```

> ⚠️ **À confirmer avant de figer `@ArrayMaxSize(6)` :** combien de vues le thème
> envoie-t-il réellement ?

---

# VAGUE 2 — Fiabilité

## 2.1 — Double e-mail : race entre webhook et synchro 🟠

**Fichier :** [src/webhooks/webhooks.service.ts:146-277](src/webhooks/webhooks.service.ts#L146-L277)

`saveOrder` fait `exists()` → … → `save()` sans transaction ni verrou :

```
T0  webhook orders/create  -> exists() = false -> isNew = true
T0  synchro périodique     -> exists() = false -> isNew = true   (save pas encore commit)
T1  les deux               -> save() (upsert : pas de doublon en base — OK)
T2  les DEUX               -> notifyNewOrder()  =>  2 e-mails pour 1 commande
```

Le verrou `syncing` protège les passes de synchro **entre elles**, mais pas contre le
webhook, qui s'exécute en parallèle. La synchro tourne toutes les 2 min et le webhook est
instantané : la collision est plausible sur une commande arrivant pendant une passe.

**Correctif :** rendre la notification idempotente via une colonne dédiée.

```ts
// order.entity.ts
/** Date d'envoi de l'alerte équipe. Non nul = déjà notifiée (anti-doublon). */
@Column({ type: 'datetime', nullable: true })
notifiedAt: Date | null;
```

```ts
// webhooks.service.ts — remplace `if (isNew && notify)`
if (notify) {
  // Écriture CONDITIONNELLE : seule la première des deux passes concurrentes
  // voit affected === 1 et envoie l'e-mail. `isNew` ne suffit pas — il est
  // calculé avant le save() et vaut true dans les deux passes.
  const res = await this.orders.update(
    { shopifyOrderId, notifiedAt: IsNull() },
    { notifiedAt: new Date() },
  );
  if (res.affected === 1) void this.notifyNewOrder(entity, lineItems.length);
}
```

> Nécessite une migration (cf. 2.6). Avec `synchronize: false`, ajouter la colonne à la
> main : `ALTER TABLE orders ADD COLUMN notifiedAt DATETIME NULL;`
>
> ⚠️ **Rétro-compatibilité :** les commandes existantes ont `notifiedAt = NULL` et
> seraient re-notifiées. Initialiser au déploiement :
> `UPDATE orders SET notifiedAt = receivedAt WHERE notifiedAt IS NULL;`

---

## 2.2 — Seed admin silencieusement avalé 🟠

**Fichier :** [src/admin/admin-auth.service.ts:155-158](src/admin/admin-auth.service.ts#L155-L158)

```ts
} catch (e) {
  this.logger.error(`Seed admin impossible : ${(e as Error).message}`);
}
```

Sur un déploiement neuf avec `DB_SYNCHRONIZE=false` (la valeur recommandée), les tables
n'existent pas → `admins.count()` lève → l'erreur est journalisée → **l'application démarre
sans aucun compte administrateur**. Le dashboard est inaccessible, sans message explicite.

La procédure documentée (activer `DB_SYNCHRONIZE=true` au premier boot puis le remettre à
`false`) fonctionne, mais elle est manuelle et repose sur le mécanisme que le commentaire
de [app.module.ts:44-53](src/app.module.ts#L44-L53) qualifie lui-même de **DANGER**.

**Correctif court terme :** distinguer « table absente » (fatal au premier démarrage) de
« erreur transitoire », et journaliser un message actionnable plutôt qu'un `error` noyé.

**Correctif durable :** migrations (2.6).

---

## 2.3 — Pool MySQL non configuré 🟡

**Fichier :** [src/app.module.ts:35-57](src/app.module.ts#L35-L57)

Aucun `extra`. `mysql2` applique son défaut `connectionLimit: 10`. Avec 100 requêtes, 90
attendent : latence cumulative → 504 côté proxy.

**Correctif :**

```ts
extra: {
  // MySQL partage le vCPU : au-delà de ~15 on ajoute de la contention, pas du
  // débit. Augmenter ce chiffre ne rend PAS l'API plus rapide.
  connectionLimit: 15,
  connectTimeout: 10000,
},
```

---

## 2.4 — `buildAndSendZip` sans timeout ni bornes 🟠

**Fichier :** [src/admin/admin.controller.ts:462-511](src/admin/admin.controller.ts#L462-L511)

```ts
await Promise.all(files.map(async (f) => {
  const r = await fetch(f.url);   // aucun timeout
  fetched.push({ name: f.name, buf: Buffer.from(await r.arrayBuffer()) });
}));
```

Trois problèmes cumulés :
1. **Aucun timeout** — contrairement à `ShopifyService.fetchShopify` et `loadImageBuffer`
   qui utilisent tous deux `AbortSignal.timeout`. Une URL lente bloque la requête admin.
2. **Parallélisme non borné** — 50 lignes × 4 propriétés = 200 téléchargements simultanés.
3. **Tout en mémoire** — buffers puis archive complète avant le premier octet envoyé.

Sur 2 Go, c'est un vecteur d'OOM.

**Correctif :** `AbortSignal.timeout(15000)`, traitement par lots de 5, et streaming du ZIP
(`zip.generateNodeStream().pipe(res)`) au lieu d'un `nodebuffer`.

---

## 2.5 — Zéro test automatisé 🟠

**Constat :** `find src -name "*.spec.ts"` → **0 fichier**. `package.json` déclare
`"test": "jest"` et `@nestjs/testing`, mais aucune config Jest n'existe.

Pour un service qui manipule de l'argent et envoie des e-mails réels à des clients, toute
régression est découverte en production.

**Priorité — 7 fonctions, toutes pures ou quasi-pures (coût faible, retour immédiat) :**

| Fonction | Fichier | Pourquoi |
|---|---|---|
| `verifyHmac` | `webhooks.service.ts` | Porte d'entrée de toutes les commandes |
| `parseToken` / `issueToken` | `admin-auth.service.ts` | Toute l'authentification |
| `verifyPassword` | `admin-auth.service.ts` | Comparaison à temps constant |
| `fromShopify` | `shipping-status.ts` | Machine à états non triviale |
| `setDraftOrderPrice` | `shopify.service.ts` | Un bug y a déjà coûté 75 % d'une facture |
| `normalizeTiers` | `pricing.service.ts` | Grilles tarifaires |
| `reminderDue` | `reminders.service.ts` | Évite le harcèlement client |

---

## 2.6 — Migrations au lieu de `synchronize` 🟠

**Fichier :** [src/app.module.ts:53](src/app.module.ts#L53)

L'opt-in explicite via `DB_SYNCHRONIZE` est un bon choix (le commentaire explique
pourquoi un test sur `NODE_ENV` serait piégeux). Mais cela laisse la création du schéma
en procédure manuelle en deux étapes — cf. 2.2.

**Correctif :** migrations TypeORM, exécutées au démarrage du conteneur
(`typeorm migration:run` avant `node dist/main`). C'est la seule solution robuste, et
c'est aussi ce qui débloque proprement 2.1.

---

# VAGUE 3 — Dette

## 3.1 — Dépendances vulnérables 🔴

`npm audit --omit=dev` sur les dépendances de **production** :

| Paquet | Sévérité | Nature |
|---|---|---|
| `@nestjs/platform-express` | **high** | via `express`, `body-parser`, `multer` |
| `@nestjs/core` | moderate | GHSA-36xv-jgw5-4q75, CWE-74, CVSS 6.1 |
| `@nestjs/common` | moderate | via `file-type` |
| `@nestjs/config` | moderate | via `lodash` |
| `body-parser` | low | DoS si `limit` invalide |

Projet sur **NestJS 10**, la 11 est corrigée. `npm audit fix --force` est semver-major :
ne pas le lancer à l'aveugle.

> **Note :** `typeorm@1.0.0` n'est **pas** un problème. J'avais écrit le contraire en v1 —
> c'est une version majeure officielle (`latest` = 1.1.0, `0.3.31` est taggé `legacy`) et
> `@nestjs/typeorm@11.0.3` déclare `peerDependencies: { typeorm: "^0.3.0 || ^1.0.0-dev" }`.

**Correctif :** planifier la montée en NestJS 11. Ajouter Dependabot ou `npm audit` en CI —
aucun scan n'est automatisé aujourd'hui.

## 3.2 — Jetons CSRF 🟠

Défense en profondeur ne dépendant pas de la politique du navigateur : double-submit
cookie sur les routes mutantes. À faire après 1.2 et 1.3.

## 3.3 — CSP désactivée globalement 🟡

[src/main.ts:21](src/main.ts#L21) : `helmet({ contentSecurityPolicy: false })`, uniquement
à cause des scripts inline d'`admin.view.ts` (**4 288 lignes**). La protection est
supprimée pour **toute** l'application.

**Correctif :** extraire la vue vers un moteur de template, puis CSP par nonce. Ou, à
moindre coût, n'appliquer la dérogation qu'aux routes `/api/admin`.

## 3.4 — Divers 🟡

- **SVG accepté à l'upload** ([uploads.module.ts:18](src/uploads/uploads.module.ts#L18)) —
  vecteur DoS connu (« billion laughs »). À retirer **si** le configurateur ne s'en sert
  pas (à confirmer).
- **`MAX_FILE_SIZE` incohérent** — multer 15 Mo vs contrôle applicatif 10 Mo : un fichier
  de 12 Mo est bufferisé avant d'être rejeté. Aligner sur la valeur la plus stricte.
- **Rétention `designs`** — table sans purge, message d'erreur annonçant « ou expiré »
  alors qu'aucune expiration n'existe.
- **N+1 dans `syncStatuses`** ([quotes.service.ts:55-108](src/quotes/quotes.service.ts#L55-L108))
  — charge tous les devis sans `take`, un appel Shopify par devis, séquentiel, sans verrou
  anti-chevauchement (contrairement à `importFromShopify`).
- **Rate limiting login** — compteur en mémoire (perdu au redémarrage), aucun verrouillage
  de compte. `scryptSync` **bloque l'event loop** (~50 ms) : 20 logins concurrents gèlent
  le serveur une seconde. Passer à `scrypt` asynchrone.
- **ESLint / Prettier** — scripts déclarés mais binaires absents des `devDependencies`.
- **`strict: true`** absent du `tsconfig.json`.
- **`inviteAdmin`** — customer Shopify créé avant `createAdmin` : orphelin possible si la
  création échoue (cosmétique).

---

# Points à confirmer avant application

Ces réponses changent la priorité ou le contenu de certains correctifs :

| # | Question | Impacte |
|---|---|---|
| 1 | Le `.env` du VPS diffère-t-il du `.env` local ? | 1.1 (peut annuler le bloquant) |
| 2 | Le swap est-il déjà actif sur le VPS ? | 0.4 |
| 3 | Déploiement par `docker compose` ou PM2 ? | 0.3 (mitigations différentes) |
| 4 | Combien de vues le thème envoie-t-il à `preview-multi` ? | 1.8 (`@ArrayMaxSize`) |
| 5 | Le configurateur permet-il l'upload de SVG ? | 3.4 |
| 6 | Une instance définit-elle encore `ADMIN_PASSWORD` ? | 1.4 (sessions invalidées) |
| 7 | Y a-t-il un CDN devant Nginx ? | `trust proxy: 1` deviendrait faux |
| 8 | Quels scopes porte le token Shopify ? | 7 scopes requis par le code |

---

# Méthode

**Vérifié empiriquement** (scripts Node jetables, créés dans le projet puis supprimés) :
comportement CORS avec `cors@2.8.5`/`express@4.22.1`, vecteur formulaire urlencoded, coût
mémoire sharp, injection CSV, comportement `clearCookie`, cohérence
`package-lock.json`, statut réel de `typeorm@1.0.0` sur le registre npm.

**Non couvert :** aucun test d'intrusion contre une instance déployée, aucune exécution de
l'application (dépendances locales incomplètes), aucun audit des `scripts/*.mjs` (7
fichiers). `admin.view.ts` analysé par recherche ciblée sur les interpolations, pas ligne
à ligne — un XSS résiduel n'est pas exclu.

**Faux positif écarté :** `npx tsc --noEmit` échoue localement (`helmet` et
`@nestjs/throttler` introuvables), mais les deux sont bien dans `package-lock.json` et le
lockfile est cohérent. Seul le `node_modules` local est désynchronisé — le `npm ci` du
Dockerfile les installera. **Ce n'est pas un défaut du code.**
