# Polices sources pour la vectorisation des textes

Ces fichiers servent à **convertir les lettres en tracés** (`TextOutlineService`).
Le SVG produit ne contient que des contours géométriques : une fois généré, il
ne dépend plus d'aucune police, ni ici, ni chez le client, ni sur le plotter.

C'est la réponse au retour de l'atelier — *« le PNG est trop pixélisé pour être
utilisable »*. Un plotter de découpe suit le contour des lettres : il lui faut
des tracés, pas des pixels. Aucun agrandissement de PNG ne résout cela.

## Ce qui est attendu ici

Un `.ttf` (ou `.otf`) par police proposée dans le configurateur
(`assets/conf-text-editor.js`, tableau `FONTS`).

Le nom du fichier sert de clé de recherche, à la casse et aux séparateurs près :
`Bebas Neue` trouve `BebasNeue.ttf`, `Bebas-Neue.ttf` ou `bebasneue.ttf`. Un
suffixe de style donne la graisse du fichier : `Lato-Bold.ttf` est le Lato 700,
`Oswald-SemiBold.ttf` l'Oswald 600, un fichier sans suffixe vaut 400.

## ⚠ La graisse doit être celle de la boutique

La boutique ne charge qu'**une graisse par police** (lien Google Fonts de
`Configurateur-travail/layout/configurateur.liquid`) : `family=Lora:wght@700`
signifie que Lora n'existe à l'écran **qu'en 700**. Le SVG doit être tracé avec
ce même fichier, sinon l'atelier découpe des lettres plus fines que celles
validées par le client.

Ces graisses sont recopiées dans `GRAISSES_BOUTIQUE`
(`src/shared/text-outline.service.ts`). **Si vous modifiez le lien Google Fonts,
mettez les deux à jour**, puis :

```bash
npm run build && npm run verif:polices
```

Le script signale tout écart de graisse, tout NaN dans un tracé, tout contour
rogné, et toute désynchronisation avec le thème.

**Préférez des fichiers STATIQUES** à la bonne graisse. Les polices variables
fonctionnent, mais le moteur de variation d'opentype.js fait exploser certains
glyphes composites (le « é » de Merriweather 700). Le fichier exact que voit le
navigateur s'obtient directement auprès de l'API Google Fonts, qui sert du TTF
statique aux clients sans user-agent :

```bash
curl -s "https://fonts.googleapis.com/css2?family=Lora:wght@700" | grep -o 'https://[^)]*\.ttf'
# puis télécharger l'URL obtenue sous assets/fonts/Lora-Bold.ttf
```

## Les 58 polices à récupérer

Toutes sont des Google Fonts, sauf les quatre dernières (polices système).

```
Acme, Alfa Slab One, Allura, Amatic SC, Anton, Architects Daughter,
Archivo Black, Bangers, Bebas Neue, Black Ops One, Bungee, Caveat, Cinzel,
Cookie, Courgette, Creepster, Crimson Text, Dancing Script, Fjalla One,
Fredoka One, Great Vibes, Indie Flower, Kalam, Lato, Libre Baskerville,
Lobster, Lora, Luckiest Guy, Merriweather, Monoton, Montserrat, Nunito,
Open Sans, Oswald, PT Serif, Pacifico, Passion One, Patua One,
Permanent Marker, Pinyon Script, Playfair Display, Poppins, Press Start 2P,
Raleway, Righteous, Roboto, Rock Salt, Russo One, Sacramento, Satisfy,
Shadows Into Light, Shrikhand, Special Elite, Tangerine, Teko, Ubuntu,
Yellowtail
```

Plus, si vous les avez sous licence : `Arial`, `Impact`, `Courier New`,
`Times New Roman`, `Georgia`, `Verdana`, `Tahoma`.

## Comment les récupérer

**Le plus simple** — l'archive complète de Google Fonts :

1. <https://fonts.google.com> → chercher la police → **Get font** → **Download all**
2. Décompresser, garder le `.ttf` **de la graisse chargée par la boutique**
   (voir plus haut) — pas forcément le Regular
3. Déposer le fichier ici

**Plus rapide, en une fois** — le dépôt officiel :

```bash
git clone --depth 1 https://github.com/google/fonts.git /tmp/gfonts
# puis copier les .ttf voulus depuis /tmp/gfonts/ofl/<nom-en-minuscules>/
```

Les polices système (Arial, Impact…) se trouvent dans `C:\Windows\Fonts`.
**Vérifiez votre licence avant de les redistribuer** — contrairement aux Google
Fonts, elles ne sont pas librement diffusables.

## Vérifier que ça marche

Au démarrage, le backend écrit dans les logs :

```
[TextOutlineService] 58 police(s) indexée(s) pour la vectorisation.
```

Et quand une police manque au moment d'un texte :

```
[TextOutlineService] Police « Bangers » absente de .../assets/fonts :
                     ce texte ne sera pas vectorisé.
```

## Si une police manque

Le texte part **en PNG seul**. La commande n'est jamais bloquée : le client
paie, l'atelier reçoit l'aperçu — mais pas le fichier de découpe.

C'est délibéré : un SVG partiellement vectorisé serait pire, l'atelier
découperait une partie du texte sans s'apercevoir du reste. C'est tout ou rien
par texte.

## État actuel : 59 polices

Les 57 polices du catalogue sont présentes, plus `Arial` et `Impact` copiées
depuis Windows.

**Un SVG « avec des tracés » n'est pas un SVG valide.** L'ancien contrôle
vérifiait la présence de `<path>` et l'absence de `<text>` : un fichier corrompu
par des `NaN` passait les deux, alors qu'il perdait les lettres qui suivaient
(≈ 10 % des textes, 35 polices sur 59, avant septembre 2026). La validité se
contrôle désormais avec :

```bash
npm run build && npm run verif:polices
npm run verif:polices -- "Team Alpha" "Pacifico,Lora" 14,16,18,20,22,24,26,28
```

qui cherche les `NaN`, le contour rogné, le remplissage et la graisse. En
production, le service relit aussi chaque SVG avant de l'émettre : un tracé
invalide est abandonné (texte en PNG seul) et journalisé avec sa police et sa
taille.

Deux points relevés à cette occasion :

- **`FredokaOne.ttf` est la vraie Fredoka One**, telle que servie par l'API
  Google Fonts. Ce fichier contenait auparavant la variable « Fredoka », tracée
  en 300 : nettement plus fine que l'écran.

- **Graisses (septembre 2026)** : 29 polices étaient tracées dans une autre
  graisse qu'à l'écran (Montserrat et Raleway en Thin 100 au lieu de Bold 700 !).
  Les fichiers `-Bold` / `-SemiBold` ont été ajoutés pour les 23 concernées.

- **NaN dans les tracés** : `Path.toPathData` d'opentype.js produisait des
  coordonnées `NaN` (11 sur « Martin » en Lora 20 px) qui coupaient le dessin
  des lettres. Le service sérialise désormais lui-même (`enDonneesSvg`).

- **Dix polices** — dont Oswald, Roboto et Great Vibes — utilisent des tables
  de substitution qu'`opentype.js` ne sait pas lire : ses fonctions de haut
  niveau lèvent une exception. Le service bascule alors sur un parcours glyphe
  par glyphe (`charToGlyph`), qui les contourne. Mesuré sur Great Vibes : 418
  segments de Bézier, 13 contours — aucune perte de qualité.

  Ce repli abandonne les ligatures typographiques et le crénage contextuel.
  Sur du flocage (mots courts, souvent capitalisés), c'est imperceptible.
