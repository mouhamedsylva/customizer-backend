# Customizer Backend (NestJS)

Backend NestJS pour le configurateur de produits personnalises Shopify (textiles, drapeaux, coins/patchs metalliques). Remplace l'ancien backend Express `customizer-api`.

## Prerequis

- Node.js 20+ (utilise `fetch` natif)
- Un compte Shopify (Admin API), Cloudinary et un SMTP (Nodemailer)

## Installation

```bash
npm install
cp .env.example .env   # puis renseigner les variables
npm run start:dev
```

Le serveur ecoute sur `http://localhost:<PORT>/api` (PORT par defaut : 3000).

## Scripts

- `npm run build` : compile en `dist/`
- `npm run start` : demarre
- `npm run start:dev` : demarre en watch
- `npm run start:prod` : demarre le build (`node dist/main`)

## Variables d'environnement

Voir `.env.example`. Principales : `PORT`, `FRONTEND_URL` (CORS), `SHOPIFY_STORE_URL`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_API_VERSION`, `CLOUDINARY_*`, `EMAIL_*` (dont `EMAIL_TEAM` pour les devis), `MAX_FILE_SIZE`.

## Endpoints (prefixe global `/api`)

### Health
- `GET /api/health` -> `{ status, timestamp, environment }`

### Cart (draft orders Shopify)
- `POST /api/cart/add` -> body `{ variantId, quantity, properties?, draftOrderId? }`
- `GET /api/cart/:draftOrderId`
- `DELETE /api/cart/:draftOrderId/item/:lineId`

### Orders
- `POST /api/orders` -> body `{ customer: {prenom, nom, email, telephone, entreprise?, message?}, items: [{name, color?, size?, qty, price, img?, properties?}], total }` -> `{ orderId, status }`
- `GET /api/orders`
- `GET /api/orders/:id`

### Quotes (devis coins)
- `POST /api/quotes` -> body `{ customer: {nom, email, telephone, entreprise?, message?}, coin: { name, details: string[], qty, previews: [{label, base, logo?}] } }` -> `{ success, quoteId }`
- `GET /api/quotes`

### Uploads (Cloudinary)
- `POST /api/uploads/logo` (multipart, champ `file`) -> `{ url, publicId, width, height }`
- `POST /api/uploads/preview` (multipart, champ `file`)
- `DELETE /api/uploads/:publicId`

### Export & partage
- `POST /api/export/share` -> body `{ designData }` -> `{ shareId, shareUrl }`
- `GET /api/export/share/:shareId` -> `designData`
- `POST /api/export/pdf` -> `501 Not Implemented` (stub)

## Architecture

- `src/main.ts` : bootstrap (CORS `FRONTEND_URL`, `ValidationPipe` global, prefixe `api`)
- `src/app.module.ts` : `ConfigModule.forRoot({ isGlobal: true })` + modules
- `src/shared/` : services partages `@Global` (Shopify, Email, Cloudinary)
- `src/cart|orders|quotes|uploads|export|health/` : modules metier

## Notes

- Le panier et les commandes reposent sur les **draft orders** de l'Admin API Shopify.
- Les devis et les designs partages sont stockes **en memoire** (voir les `TODO` pour brancher une BDD).
