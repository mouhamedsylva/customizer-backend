# Audit de production — customizer-backend

**Date :** 2026-08-05
**Périmètre :** intégralité du dépôt `customizer-backend` (branche `main`, commit `231ef07`)
**Nature :** revue de code pré-mise en production (sécurité, architecture, fiabilité, DevOps)
**Méthode :** lecture exhaustive des 40 fichiers `src/`, de la configuration Docker/Nixpacks, du `package.json`, de l'historique Git et de l'état réel du `.env` local.

---

## 1. Verdict

**Ne pas déployer en l'état.** Trois défauts bloquants doivent être corrigés avant toute mise en production. Deux d'entre eux sont des défauts de configuration du serveur cible (variables d'environnement absentes), le troisième est un défaut de code (absence de protection CSRF).

Le code présente par ailleurs un niveau de soin très supérieur à la moyenne : les commentaires documentent systématiquement *pourquoi* une décision a été prise, y compris les bugs passés et leurs conséquences métier. Un durcissement sécurité récent (commit `0cc09ab`) a déjà traité la majorité des vulnérabilités classiques — SSRF, HMAC permissif, routes publiques exposant des données personnelles, XSS dans les e-mails. Les problèmes restants sont concentrés et identifiables.

| Gravité | Nombre |
|---|---|
| 🔴 Bloquant | 3 |
| 🟠 Majeur | 7 |
| 🟡 Modéré | 9 |
| 🔵 Mineur / dette | 8 |

---

## 2. Architecture — vue d'ensemble

### 2.1 Rôle du service

Backend NestJS servant un configurateur de produits personnalisés (textiles, patchs, drapeaux, coins) intégré à une boutique Shopify. Il assure :

- la réception des commandes Shopify via webhook + synchronisation périodique de rattrapage ;
- la création de devis (draft orders Shopify) depuis le configurateur public ;
- la relance automatique des devis impayés ;
- l'upload et la composition d'images (Cloudinary + sharp) ;
- un dashboard admin autonome rendu en HTML côté serveur ;
- la gestion des prix, répercutés sur les variants Shopify.

### 2.2 Découpage modulaire

Le découpage est propre et cohérent. Chaque domaine métier a son module, ses DTO et son service. `SharedModule` est `@Global` et expose les trois intégrations externes (Shopify, Email, Cloudinary). `SettingsModule` est correctement extrait pour éviter un cycle entre `AdminModule` et `QuotesModule` — la note en commentaire de [settings.module.ts](src/admin/settings.module.ts) montre que c'est un choix conscient, pas un accident.

Les dépendances entre modules sont acycliques et documentées à chaque import :

```
AppModule
├── SharedModule (@Global) ── Shopify / Email / Cloudinary
├── AdminModule ──────────── exporte AdminAuthService + AdminSessionGuard
│   └── SettingsModule ───── SettingsService + PricingService
├── QuotesModule ─────────── importe AdminModule (guard) + SettingsModule
├── OrdersModule ─────────── importe AdminModule (guard)
├── UploadsModule ────────── importe AdminModule (guard)
├── WebhooksModule ───────── importe SettingsModule
├── PricingModule ────────── importe SettingsModule (lecture publique)
├── CartModule / ExportModule / HealthModule
```

### 2.3 Point d'architecture majeur : `admin.view.ts`

**4 288 lignes** pour un seul fichier générant du HTML par concaténation de chaînes, avec CSS et JavaScript inline. C'est le principal foyer de dette technique du projet. Conséquences directes et mesurables :

- la CSP est **désactivée globalement** dans [main.ts:21](src/main.ts#L21) uniquement à cause de ce fichier — une protection XSS de défense en profondeur sacrifiée pour une contrainte de présentation ;
- toute évolution de l'UI implique de manipuler du HTML non typé et non testé ;
- la sécurité XSS repose entièrement sur la discipline manuelle d'appeler `esc()` à chaque interpolation (176 occurrences dans le fichier).

---

## 3. 🔴 Défauts bloquants

### 3.1 — `SHOPIFY_WEBHOOK_SECRET` absent du `.env` : tous les webhooks sont rejetés

**Fichiers :** [webhooks.service.ts:105-118](src/webhooks/webhooks.service.ts#L105-L118), `.env`

Le code a été durci — à raison — pour rejeter tout webhook quand le secret est absent :

```ts
const secret = this.config.get<string>('SHOPIFY_WEBHOOK_SECRET');
if (!secret) {
  this.logger.error('SHOPIFY_WEBHOOK_SECRET absent : webhook REJETÉ. …');
  return false;
}
```

Le durcissement est correct. Le problème est que **le `.env` réellement présent sur cette machine ne définit pas cette variable**. Il ne contient ni `SHOPIFY_WEBHOOK_SECRET`, ni `ADMIN_SESSION_SECRET`, ni `DB_SYNCHRONIZE`, ni `ADMIN_SEED_*`, ni `BACKEND_URL` — il correspond à l'ancien `.env.example`, pas à `.env.production.example` qui les documente tous.

**Conséquence si ce `.env` part en production :** `POST /api/webhooks/orders-create` et `orders-updated` répondent systématiquement `401`. Shopify retente puis désactive le webhook. Les commandes ne remontent plus en temps réel. Le seul filet restant est la synchro périodique toutes les 2 minutes — qui fonctionne, mais qui décale la détection, et surtout **qui n'existe que si le token Shopify porte le scope `read_orders`**. En cas d'échec des deux, une commande payée n'apparaît jamais dans le dashboard : l'atelier ne la produit pas.

**Correction :** repartir de `.env.production.example` pour construire le `.env` de production et renseigner `SHOPIFY_WEBHOOK_SECRET` avec la clé fournie par Shopify (Paramètres → Notifications → Webhooks).

**Vérification post-déploiement :** déclencher une commande de test et confirmer un `200` dans les logs, pas un `401`.

---

### 3.2 — Aucune protection CSRF sur le dashboard admin

**Fichiers :** [admin.controller.ts](src/admin/admin.controller.ts) (intégralité), [main.ts:133-138](src/main.ts#L133-L138)

Le cookie de session est posé avec `sameSite: 'lax'` :

```ts
res.cookie(this.auth.cookieName, this.auth.issueToken(admin.id), {
  httpOnly: true,
  sameSite: 'lax',
  secure: true,
  maxAge: 1000 * 60 * 60 * 12,
});
```

`httpOnly`, `secure` et `maxAge` sont corrects. Mais `lax` **n'est pas une protection CSRF pour les requêtes POST cross-site** : il bloque les POST déclenchés depuis un autre site, ce qui couvre le cas classique du formulaire caché — mais la protection s'effondre dès qu'une origine autorisée par le CORS peut émettre la requête.

Or la politique CORS de [main.ts:92-117](src/main.ts#L92-L117) autorise **tout sous-domaine `*.myshopify.com` en HTTPS**, avec `credentials: true` :

```ts
const isShopifyOrigin = (origin: string): boolean => {
  const { hostname, protocol } = new URL(origin);
  return protocol === 'https:' && hostname.endsWith('.myshopify.com');
};
```

Le contrôle du hostname parsé (plutôt qu'un `endsWith` sur la chaîne brute) est bien fait et bloque `evil-myshopify.com`. Mais **n'importe qui peut créer une boutique `myshopify.com` gratuitement en quelques minutes**, y injecter du JavaScript via le thème, et disposer alors d'une origine que ce backend autorise avec `credentials: true`.

**Scénario d'exploitation :**
1. L'attaquant crée `attaquant-test.myshopify.com`.
2. Il y place une page appelant `fetch('https://api.exemple.fr/api/admin/pricing', {method:'POST', credentials:'include', body: …})`.
3. Il envoie le lien à un administrateur du dashboard, connecté (session 12 h).
4. Le navigateur joint le cookie. Le CORS autorise l'origine. Aucun jeton CSRF n'est vérifié.

**Actions atteignables** — toutes les routes `POST` d'`AdminController`, dont :
- `POST /api/admin/pricing` — modifier les prix, **répercutés automatiquement sur les variants Shopify** ([admin.controller.ts:882-894](src/admin/admin.controller.ts#L882-L894)). Prix à 0,01 € sur toute la boutique.
- `POST /api/admin/quotes/:id/invoice` — envoyer une facture à un client à un prix arbitraire.
- `POST /api/admin/orders/:id/status` avec `status: 'shipped'` — marquer expédié dans Shopify, ce qui **déclenche l'e-mail d'expédition réel au client**.
- `POST /api/admin/admins` (si la victime est `owner`) — créer un compte administrateur.

La réponse n'est pas lisible par l'attaquant sur les endpoints qui refusent l'origine, mais **l'effet de bord côté serveur est déjà produit** : c'est la définition même du CSRF.

**Correction (par ordre d'efficacité) :**

1. **Passer le cookie en `sameSite: 'strict'`.** Correction d'une ligne. Le dashboard est une page autonome servie par la même origine — aucune navigation cross-site légitime n'a besoin du cookie. C'est le correctif à appliquer immédiatement.
2. **Restreindre `isShopifyOrigin` à la boutique réelle**, en comparant à `SHOPIFY_STORE_URL` plutôt qu'à tout `.myshopify.com`. Le wildcard n'a de justification qu'en développement.
3. **Ajouter un jeton CSRF** (double-submit cookie) sur les routes mutantes, pour une défense en profondeur qui ne dépend pas de la politique du navigateur.

---

### 3.3 — Vulnérabilités connues dans les dépendances, dont une `high`

**Fichier :** [package.json](package.json)

`npm audit --omit=dev` remonte des vulnérabilités sur les dépendances **de production** :

| Paquet | Sévérité | Nature |
|---|---|---|
| `@nestjs/platform-express` | **high** | via `express`, `body-parser`, `multer` |
| `@nestjs/core` | moderate | GHSA-36xv-jgw5-4q75 — injection (CWE-74), CVSS 6.1 |
| `@nestjs/common` | moderate | via `file-type` |
| `@nestjs/config` | moderate | via `lodash` |
| `body-parser` | low→moderate | DoS : une valeur de `limit` invalide désactive silencieusement le contrôle de taille |

Le projet est sur **NestJS 10** alors que la 11 est disponible et corrigée. L'avis sur `body-parser` mérite une attention particulière ici : [main.ts:28-38](src/main.ts#L28-L38) configure explicitement `json({ limit: '25mb' })` — une limite élevée mais valide, donc non concernée par ce cas précis, à condition qu'elle ne soit jamais rendue dynamique.

**Correction :** planifier la montée en NestJS 11 (`npm audit fix --force` est semver-major, à ne pas lancer à l'aveugle). À défaut de temps avant la mise en production, documenter l'exposition résiduelle et fixer une date.

**Recommandation durable :** aucun scan de dépendances n'est automatisé. Ajouter Dependabot ou un `npm audit` en CI.

---

## 4. 🟠 Défauts majeurs

### 4.1 — Le seed admin est silencieusement ignoré si la table n'existe pas encore

**Fichier :** [admin-auth.service.ts:113-159](src/admin/admin-auth.service.ts#L113-L159)

```ts
} catch (e) {
  this.logger.error(`Seed admin impossible : ${(e as Error).message}`);
}
```

Le commentaire reconnaît le cas : « la table n'existe peut-être pas encore au tout premier démarrage ». C'est précisément ce qui se produit sur un déploiement neuf avec `DB_SYNCHRONIZE=false` (la valeur recommandée) : les tables n'existent pas, le seed échoue, l'erreur est journalisée, l'application démarre **sans aucun compte administrateur**. Le dashboard devient inaccessible, sans message explicite pour l'exploitant.

La procédure documentée dans `.env.production.example` (activer `DB_SYNCHRONIZE=true` au premier boot, puis le remettre à `false`) fonctionne, mais elle est manuelle, en deux étapes, et repose sur le mécanisme même que le commentaire de [app.module.ts:44-53](src/app.module.ts#L44-L53) qualifie de **DANGER**.

**Correction :** introduire de vraies migrations TypeORM (`typeorm migration:run` au démarrage du conteneur). C'est la seule solution robuste pour un service en production. À défaut, faire échouer le démarrage bruyamment si aucun admin n'existe et que la table est absente.

---

### 4.2 — Zéro test automatisé

**Constat :** `find src -name "*.spec.ts" -o -name "*.test.ts"` → **0 fichier**. `package.json` déclare `"test": "jest"` et `@nestjs/testing` en devDependency, mais aucune configuration Jest n'existe et aucun test n'est écrit.

Pour un service qui manipule de l'argent (prix répercutés sur Shopify, facturation, relances client) et envoie des e-mails réels à des clients, c'est un risque structurel majeur. Toute régression est découverte en production.

**Logique critique non couverte, par ordre de priorité :**

| Cible | Pourquoi c'est critique |
|---|---|
| `verifyHmac()` | Porte d'entrée de toutes les commandes |
| `parseToken()` / `issueToken()` | Toute l'authentification admin |
| `verifyPassword()` | Comparaison à temps constant |
| `fromShopify()` | Machine à états du suivi de production, non triviale |
| `setDraftOrderPrice()` | Un bug ici a déjà coûté 75 % du montant d'une facture (cf. commentaire ligne 481) |
| `normalizeTiers()` | Grilles tarifaires |
| `reminderDue()` | Évite le harcèlement du client par relances |

**Correction :** couvrir en priorité ces sept fonctions. Ce sont des fonctions pures ou quasi-pures — le coût d'écriture est faible et le retour immédiat.

---

### 4.3 — `POST /api/export/preview-image` et `preview-multi` : endpoints publics coûteux

**Fichiers :** [export.controller.ts:38-70](src/export/export.controller.ts#L38-L70), [cloudinary.service.ts:258-447](src/shared/cloudinary.service.ts#L258-L447)

Ces deux routes sont publiques et déclenchent, par requête :
- N téléchargements HTTP externes (timeout 15 s chacun) ;
- N décodages et redimensionnements sharp (opérations CPU et mémoire lourdes) ;
- un upload Cloudinary (facturé).

`preview-multi` accepte un tableau `views` **sans borne supérieure** ([preview-multi.dto.ts:43-48](src/export/dto/preview-multi.dto.ts#L43-L48) : `@ArrayNotEmpty()` seul), chaque vue portant elle-même un tableau `logos` non borné. Le rate limiting global est de 120 requêtes/minute/IP — largement suffisant pour saturer le CPU du conteneur ou faire exploser la facture Cloudinary.

Le corps JSON étant plafonné à 25 Mo, un attaquant peut soumettre des centaines de vues en une seule requête.

**Correction :** ajouter `@ArrayMaxSize(6)` sur `views`, `@ArrayMaxSize(10)` sur `logos`, et un `@Throttle` spécifique (par exemple 10 requêtes/minute) sur ces deux routes.

---

### 4.4 — `GET /api/export/share/:shareId` : énumération de designs clients

**Fichier :** [export.service.ts:48-54](src/export/export.service.ts#L48-L54)

La route est publique et renvoie l'intégralité de `designData`. L'identifiant est un UUID v4 — non devinable en pratique, ce qui constitue la protection réelle. Deux réserves :

- aucune expiration n'est implémentée, alors que le message d'erreur annonce « introuvable **ou expiré** » ;
- la table `designs` croît indéfiniment (aucune purge).

**Correction :** ajouter une politique de rétention (purge des designs de plus de N mois) et aligner le message d'erreur sur le comportement réel.

---

### 4.5 — `buildAndSendZip` : téléchargement parallèle non borné en mémoire

**Fichier :** [admin.controller.ts:462-511](src/admin/admin.controller.ts#L462-L511)

```ts
await Promise.all(
  files.map(async (f) => {
    const r = await fetch(f.url);   // aucun timeout
    fetched.push({ name: f.name, buf: Buffer.from(await r.arrayBuffer()) });
  }),
);
```

Trois problèmes cumulés :

1. **Aucun timeout** sur ces `fetch` — contrairement à `ShopifyService.fetchShopify` et à `loadImageBuffer`, qui utilisent tous deux `AbortSignal.timeout`. Une URL Cloudinary lente bloque la requête HTTP admin indéfiniment.
2. **Parallélisme non borné** : une commande à 50 lignes × 4 propriétés déclenche 200 téléchargements simultanés.
3. **Tout en mémoire** : les buffers, puis l'archive complète, avant le moindre octet envoyé. Une commande volumineuse peut faire tomber le conteneur (OOM).

**Correction :** `AbortSignal.timeout(15000)`, parallélisme borné (lots de 5), et streaming du ZIP vers la réponse plutôt qu'un buffer complet.

---

### 4.6 — La stack trace complète est renvoyée au client

**Fichier :** [admin.controller.ts:406-412](src/admin/admin.controller.ts#L406-L412)

```ts
res.status(500).type('text').send('ZIP ERROR:\n' + ((err as Error)?.stack || String(err)));
```

Une stack trace expose les chemins du système de fichiers, la structure interne et les versions de bibliothèques. Le commentaire justifie ce choix par le confort de diagnostic — mais le projet dispose déjà de `throwUpstream()` ([upstream-error.ts](src/shared/upstream-error.ts)), écrit précisément pour ce problème et correctement utilisé dans `CartService` et `OrdersService`.

La route exige une session admin, ce qui limite la portée. Combiné au CSRF non protégé (§3.2), le risque n'est toutefois pas nul.

**Correction :** utiliser `throwUpstream(this.logger, 'Impossible de construire l\'archive.', err)`.

---

### 4.7 — Le rate limiting du login se contourne trivialement

**Fichiers :** [admin.controller.ts:121](src/admin/admin.controller.ts#L121), [main.ts:16](src/main.ts#L16)

`@Throttle({ default: { limit: 5, ttl: 60000 } })` limite à 5 tentatives/minute **par IP**. Deux limites :

1. Le compteur est **en mémoire du process**. Tout redémarrage du conteneur remet les compteurs à zéro, et le déploiement en cluster le rendrait inopérant.
2. Il n'existe **aucun verrouillage de compte** après N échecs. Un attaquant disposant d'un pool d'IP contourne intégralement la limite.

`trust proxy: 1` est correctement configuré pour que `req.ip` soit l'IP réelle derrière Nginx — à condition que Nginx soit bien le seul proxy en amont. Si un CDN est ajouté plus tard sans ajuster cette valeur, `req.ip` deviendra celle du CDN et **le rate limiting s'appliquera globalement à tous les utilisateurs**.

**Atténuation existante :** `scryptSync` coûte ~50 ms par tentative, ce qui borne le débit d'attaque. Mais c'est aussi un vecteur de DoS : l'appel est **synchrone et bloque l'event loop**. 20 requêtes de login concurrentes gèlent le serveur pendant une seconde.

**Correction :** verrouillage temporaire du compte après 10 échecs consécutifs ; à terme, stockage du throttler dans Redis ; remplacer `scryptSync` par `scrypt` asynchrone.

---

## 5. 🟡 Défauts modérés

### 5.1 — CSP désactivée globalement

[main.ts:21](src/main.ts#L21) : `helmet({ contentSecurityPolicy: false })`. Justifié par les scripts inline du dashboard, mais cela supprime la défense en profondeur XSS **pour toute l'application**, y compris les routes qui n'ont rien à voir avec le dashboard.

**Correction :** générer un nonce par requête et appliquer une CSP `script-src 'nonce-…'`, ou n'appliquer la dérogation qu'aux routes `/api/admin`.

### 5.2 — `MAX_FILE_SIZE` : deux limites incohérentes

[uploads.module.ts:14](src/uploads/uploads.module.ts#L14) fixe multer à 15 Mo ; [uploads.controller.ts:36-41](src/uploads/uploads.controller.ts#L36-L41) contrôle ensuite `MAX_FILE_SIZE` (défaut 10 Mo). Un fichier de 12 Mo est donc entièrement transféré et bufferisé en mémoire avant d'être rejeté. Le contrôle applicatif devrait être le plus strict, pas le plus permissif.

### 5.3 — SVG accepté à l'upload

[uploads.module.ts:18](src/uploads/uploads.module.ts#L18) autorise `image/svg+xml`. Le SVG est un format XML susceptible de porter du JavaScript et des entités externes (XXE). sharp/librsvg le rastérise, ce qui neutralise l'essentiel du risque — mais **le SVG est aussi un vecteur de DoS** connu (« billion laughs », références récursives) traité par librsvg avant rastérisation.

**Correction :** exclure `svg+xml` si le configurateur n'en a pas l'usage — à vérifier côté thème.

### 5.4 — `isAllowedImageUrl` : logique de suffixe partiellement incorrecte

[cloudinary.service.ts:206](src/shared/cloudinary.service.ts#L206) :

```ts
return allowedSuffixes.some((s) => host === s.replace(/^\./, '') || host.endsWith(s));
```

Pour `'res.cloudinary.com'` (sans point initial), `s.replace(/^\./, '')` est un no-op et `host.endsWith('res.cloudinary.com')` accepterait `evilres.cloudinary.com`. Ce cas est déjà couvert par l'entrée `'.cloudinary.com'`, donc l'impact est nul en pratique — mais l'entrée est trompeuse et fragile à toute modification future.

Le reste de la protection SSRF est de bonne facture : `redirect: 'manual'`, blocage des IP internes, message d'erreur ne révélant pas l'hôte atteint. La limite est correctement documentée dans le code (pas de résolution DNS, donc un nom public pointant vers une IP privée passe).

### 5.5 — Aucune limite de taille sur `designData` et `quoteData`

`ShareDesignDto.designData` est un `Record<string, unknown>` non contraint, stocké en colonne `json`. Avec un corps de 25 Mo autorisé, la table `designs` peut être remplie à volonté depuis un endpoint public. Même remarque pour `quoteData` — d'autant que les devis « coins » embarquent des aperçus en base64.

### 5.6 — `POST /api/quotes` public sans anti-spam

[quotes.controller.ts:14-19](src/quotes/quotes.controller.ts#L14-L19). Chaque devis crée un draft order Shopify et envoie **deux e-mails**. Le throttle global (120/min) autorise donc 120 draft orders et 240 e-mails par minute et par IP. Risque de blacklistage de la réputation SMTP et de saturation du quota API Shopify.

**Correction :** `@Throttle` spécifique (5/min) + captcha ou honeypot côté thème.

### 5.7 — `GET /api/health/variants` : endpoint de debug public

[health.controller.ts:37-56](src/health/health.controller.ts#L37-L56). Expose les IDs produits et variants Shopify, ainsi que **les prix**, sans authentification. Il déclenche par ailleurs 5 appels API Shopify par requête — donc consommable pour épuiser le quota Shopify.

Le commentaire indique « À utiliser une fois pour remplir les `window.CONF_VARIANT_*` ». C'est un outil de mise en place qui n'a plus sa place en production.

**Correction :** protéger par `AdminSessionGuard` ou supprimer.

### 5.8 — Journalisation du mot de passe admin en clair

[admin-auth.service.ts:146-153](src/admin/admin-auth.service.ts#L146-L153). Le mot de passe généré au seed est écrit dans les logs. Le compromis est assumé et documenté, et c'est une pratique courante pour l'amorçage — mais si les logs sont agrégés (Railway, Datadog, syslog), ce mot de passe est répliqué et conservé hors du serveur.

**Correction :** privilégier `ADMIN_SEED_PASSWORD` en production, et forcer le changement à la première connexion.

### 5.9 — `syncStatuses` : N+1 requêtes Shopify

[quotes.service.ts:55-108](src/quotes/quotes.service.ts#L55-L108). La méthode charge **tous** les devis ayant un `draftOrderId` (sans `take`) et effectue un appel Shopify **par devis**, séquentiellement, toutes les 10 minutes. À 500 devis, cela représente 500 appels séquentiels par cycle. Le quota Shopify (2 req/s en REST) sera atteint et la passe pourra dépasser son propre intervalle — sans verrou anti-chevauchement, contrairement à `WebhooksService.importFromShopify` qui, lui, en dispose.

**Correction :** filtrer sur les devis non terminés uniquement (le `continue` sur `completed` intervient trop tard, après le chargement), borner avec `take`, et ajouter un verrou `syncing`.

---

## 6. 🔵 Points mineurs et dette

| # | Point | Fichier |
|---|---|---|
| 6.1 | `typeorm: "^1.0.0"` dans `package.json` — version fantaisiste ; la vraie ligne stable est 0.3.x. Fonctionne via la résolution de `@nestjs/typeorm`, mais c'est trompeur | [package.json:39](package.json#L39) |
| 6.2 | Aucune configuration ESLint ni Prettier présente, alors que `package.json` déclare les scripts `lint` et `format` — ils échouent | [package.json:10,15](package.json#L10) |
| 6.3 | `tsconfig.json` : `strict` n'est pas activé (seulement `strictNullChecks` et `noImplicitAny`). `strictPropertyInitialization` absent, d'où les `!` sur les entités | [tsconfig.json](tsconfig.json) |
| 6.4 | `dist/` présent sur le disque mais non suivi par Git (correct) — pensez à le purger avant un build Docker pour éviter toute confusion | — |
| 6.5 | `scripts/*.mjs` : 7 scripts utilitaires non documentés, non testés, susceptibles de contenir des identifiants ou d'effectuer des écritures Shopify | [scripts/](scripts/) |
| 6.6 | Le Dockerfile copie `node_modules` depuis l'étape de build après `npm prune` — correct — mais `COPY . .` inclut tout le contexte non filtré par `.dockerignore`. Ce dernier exclut bien `.env`, `dist`, `.git` et `scripts` : **c'est bon** | [Dockerfile:8](Dockerfile#L8) |
| 6.7 | `docker-compose.yml` : `MYSQL_ROOT_PASSWORD` est exposé au conteneur `db`. Standard, mais le healthcheck le passe en ligne de commande (`mysqladmin -p"$$MYSQL_ROOT_PASSWORD"`), donc visible dans la table des processus du conteneur | [docker-compose.yml:28](docker-compose.yml#L28) |
| 6.8 | Aucune limite de ressources (`mem_limit`, `cpus`) sur les services Docker — un OOM du conteneur API peut affecter l'hôte | [docker-compose.yml](docker-compose.yml) |

---

## 7. Ce qui est bien fait

Il serait injuste de ne lister que les défauts. Ces points sont d'un niveau nettement au-dessus de la moyenne :

- **Protection SSRF** ([cloudinary.service.ts:164-251](src/shared/cloudinary.service.ts#L164-L251)) : liste blanche d'hôtes, blocage des IP internes (y compris `169.254.169.254`), `redirect: 'manual'`, message d'erreur ne servant pas d'oracle. Rare à ce niveau de rigueur.
- **Comparaisons à temps constant** : `timingSafeEqual` avec contrôle préalable de longueur, dans `verifyHmac`, `parseToken` et `verifyPassword`.
- **Échappement HTML centralisé** ([html.util.ts](src/shared/html.util.ts)) et appliqué aux e-mails, avec un commentaire expliquant la vulnérabilité corrigée.
- **`AdminSessionGuard` interroge la base** plutôt que de se fier à la seule signature du cookie : un admin bloqué perd l'accès immédiatement, sans attendre l'expiration des 12 h.
- **Gestion de la pagination Shopify** avec le drapeau `truncated` et une fenêtre de synchro non avancée en cas de troncature ([webhooks.service.ts:467-486](src/webhooks/webhooks.service.ts#L467-L486)) — un raisonnement subtil et correct.
- **Protection contre l'écrasement des données client** lors des re-synchronisations ([webhooks.service.ts:226-248](src/webhooks/webhooks.service.ts#L226-L248)).
- **Verrou anti-chevauchement** sur la synchro des commandes, avec `try/finally`.
- **Timeouts** sur tous les appels Shopify et sur le SMTP.
- **`enableShutdownHooks()`** avec `onModuleDestroy` nettoyant les trois timers.
- **Signalement explicite de la troncature des exports CSV** dans le fichier lui-même, pas seulement dans les logs — le raisonnement (« c'est le CSV qui part chez le comptable, pas la console ») est exactement le bon.
- **Qualité des commentaires** : ils documentent les bugs passés, leurs conséquences métier chiffrées, et pourquoi une alternative a été écartée. C'est la meilleure documentation d'un projet de cette taille.

---

## 8. Plan d'action

### Avant toute mise en production

| # | Action | Effort |
|---|---|---|
| 1 | Construire le `.env` de production à partir de `.env.production.example` — renseigner `SHOPIFY_WEBHOOK_SECRET`, `ADMIN_SESSION_SECRET`, `DB_SYNCHRONIZE=false` | 15 min |
| 2 | Passer le cookie de session en `sameSite: 'strict'` | 5 min |
| 3 | Restreindre `isShopifyOrigin` à `SHOPIFY_STORE_URL` en production | 20 min |
| 4 | Protéger ou supprimer `GET /api/health/variants` | 10 min |
| 5 | Remplacer la stack trace de `downloadAssets` par `throwUpstream` | 10 min |
| 6 | `@ArrayMaxSize` sur `views` / `logos` + `@Throttle` sur `preview-*` et `POST /quotes` | 45 min |
| 7 | Valider le premier démarrage : création des tables **et** du compte admin | 30 min |

### Dans les deux semaines

| # | Action |
|---|---|
| 8 | Tests unitaires sur les 7 fonctions critiques (§4.2) |
| 9 | Migrations TypeORM en remplacement de `synchronize` |
| 10 | Timeout + parallélisme borné + streaming sur `buildAndSendZip` |
| 11 | Verrouillage de compte après N échecs de connexion |
| 12 | Correctif N+1 et verrou sur `syncStatuses` |
| 13 | Configuration ESLint + Prettier, `strict: true` |

### À moyen terme

| # | Action |
|---|---|
| 14 | Montée en NestJS 11 + Dependabot / `npm audit` en CI |
| 15 | Jetons CSRF (double-submit) sur les routes mutantes |
| 16 | Extraction de `admin.view.ts` vers un moteur de template, puis réactivation de la CSP |
| 17 | Throttler distribué (Redis) et politique de rétention des `designs` |
| 18 | Limites de ressources Docker + supervision (Sentry ou équivalent) |

---

## 9. Points nécessitant votre confirmation

Ces éléments ne sont pas vérifiables depuis le dépôt seul :

1. **Le `.env` de production diffère-t-il du `.env` local ?** Mon analyse du §3.1 part du fichier présent sur cette machine. Si le serveur cible dispose déjà d'un `.env` complet, ce point bloquant tombe — mais il reste à confirmer explicitement.
2. **Le thème Shopify appelle-t-il `POST /api/export/preview-multi` avec plus de 6 vues ?** Cela conditionne la valeur de `@ArrayMaxSize`.
3. **Le configurateur autorise-t-il l'upload de SVG ?** Si non, le format peut être retiré sans risque de régression.
4. **Y a-t-il un CDN devant Nginx ?** Cela change la valeur correcte de `trust proxy`.
5. **Quels scopes porte réellement le token Shopify ?** Le code en requiert au minimum : `read_orders`, `read_products`, `write_products`, `read_customers`, `write_customers`, `read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders`.
6. **Que contiennent les scripts `scripts/*.mjs` ?** Je ne les ai pas audités — ils sortent du périmètre du service exécuté, mais peuvent contenir des identifiants.

---

*Audit réalisé par lecture exhaustive du code source. Aucun test dynamique ni test d'intrusion n'a été effectué — les vulnérabilités décrites sont identifiées par analyse statique et n'ont pas été exploitées.*
