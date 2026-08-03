# --- Étape 1 : build TypeScript -> dist/ ---
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build \
 && npm prune --omit=dev

# --- Étape 2 : image d'exécution ---
FROM node:20-alpine

# fontconfig + DejaVu : sharp compose les libellés des planches multi-vues
# (FACE, DOS…) via un SVG ; sans vraie police, librsvg rend des rectangles
# vides. Même besoin que sur Railway (voir nixpacks.toml).
RUN apk add --no-cache fontconfig ttf-dejavu

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node
EXPOSE 3000
CMD ["node", "dist/main"]
