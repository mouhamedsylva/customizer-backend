# Tester la vectorisation des textes en local

Trois niveaux, du plus simple au plus complet. **Le premier suffit à valider ce
qui compte** — la réponse au retour de l'atelier : *« le PNG est trop pixélisé
pour être utilisable »*.

---

## Niveau 1 — l'aperçu visuel (30 secondes, rien à installer)

Ni base de données, ni Cloudinary, ni serveur.

```bash
cd customizer-backend
npm run build
npm run apercu:texte
```

Deux sorties :

- **`apercu-texte.html`** — à ouvrir dans un navigateur. Les 59 polices, rendues
  à partir de leur SVG réel, avec un agrandissement ×4 en haut de page.
- **`apercu-texte/*.svg`** — les fichiers eux-mêmes, à ouvrir dans Illustrator
  ou Inkscape.

### Le test qui tranche

Ouvrez un `.svg` dans **Illustrator** et agrandissez à 800 %.

- Les contours restent **parfaitement nets** → c'est du vectoriel, le problème
  du client est résolu.
- Sélectionnez une lettre : elle doit se comporter comme une **forme**, pas
  comme du texte. C'est ce que suivra le plotter de découpe.

### Choisir le texte et la police

```bash
npm run apercu:texte -- "VOTRE TEXTE"
npm run apercu:texte -- "VOTRE TEXTE" GreatVibes 160
```

---

## Niveau 2 — la route HTTP (avec Laragon)

Vérifie que la chaîne serveur complète répond.

```bash
# Laragon démarré (MySQL sur 3306)
npm run start:prod
```

Dans un autre terminal :

```bash
curl -X POST http://127.0.0.1:3000/api/uploads/text-svg \
  -H "Content-Type: application/json" \
  -d '{"segments":[{"text":"MASSACRE","fontFamily":"Oswald","fontSize":120,"fontWeight":"400","color":"#c2410c"}],"productType":"tshirt","placement":"front"}'
```

### Ce que vous devez voir dans les logs

```
[TextOutlineService] 60 police(s) indexée(s) pour la vectorisation.
[TextOutlineService] SVG vectoriel : 547.72x241.84, 1 segment(s)
```

Ces deux lignes prouvent que la vectorisation fonctionne.

### L'erreur 502 est NORMALE sans clés Cloudinary

```json
{"statusCode":502,"message":"Echec generation texte SVG: cloud_name is disabled"}
```

Le SVG **a été produit** (le log le montre) ; seul son dépôt échoue. La
vectorisation est faite avant tout appel réseau, précisément pour que son
résultat reste visible même quand Cloudinary est absent.

Pour aller jusqu'au dépôt, renseignez dans `.env` :

```
CLOUDINARY_CLOUD_NAME=…
CLOUDINARY_API_KEY=…
CLOUDINARY_API_SECRET=…
```

⚠️ Ce sont les clés de **production** : les fichiers déposés lors de vos tests
atterriront sur le compte réel, dans `customizer/text/`. Pensez à faire le
ménage, ou créez un compte Cloudinary gratuit dédié au développement.

---

## Niveau 3 — la chaîne complète depuis le configurateur

Le configurateur tourne sur Shopify, pas en local : il ne peut pas appeler
`127.0.0.1`. Deux options.

### Option A — pousser sur le VPS (le plus simple)

Déployer le backend, pousser le thème, puis commander un texte et ouvrir le ZIP
« Tous les fichiers » depuis le dashboard. Le `.svg` doit s'y trouver à côté du
`.png`.

C'est la voie normale, et la seule qui valide aussi le passage par le panier
Shopify.

### Option B — un tunnel vers votre machine

```bash
npx localtunnel --port 3000
# ou : cloudflared tunnel --url http://localhost:3000
```

Puis, dans `layout/configurateur.liquid`, remplacer temporairement :

```js
window.API_BASE = "https://vps-c1a07d74.vps.ovh.net/api";
```

par l'URL du tunnel suivie de `/api`, et pousser le thème.

⚠️ **À ne jamais laisser en place.** Le thème est en ligne : vos clients
passeraient par votre machine. Rétablissez l'URL du VPS dès le test terminé.

---

## Ce qui a déjà été vérifié

- **59 polices sur 59** produisent un SVG vectoriel valide — testées une par une.
- Aucun `<text>` ni `font-family` dans les fichiers produits : ils ne dépendent
  d'aucune police installée.
- Great Vibes : 418 segments de Bézier, 13 contours.
- Police absente → `null` et un avertissement nommant la police ; la commande
  n'est jamais bloquée.
- Le ZIP nomme correctement le fichier `.svg` (extension déduite de l'URL).

## Le seul verdict qui compte

Envoyer un `.svg` à votre client et lui faire lancer une **vraie découpe**.
C'est sa remarque qui a déclenché ce travail.
