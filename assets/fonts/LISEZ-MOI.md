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
suffixe de style est toléré : `Anton-Regular.ttf` répond à la demande `Anton`.

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
2. Décompresser, garder le `.ttf` **Regular** (les variantes Bold / Italic ne
   sont pas nécessaires : le configurateur applique la graisse par le style CSS,
   pas par un fichier distinct)
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

## État actuel : 59 polices, toutes vérifiées

Les 57 polices du catalogue sont présentes, plus `Arial` et `Impact` copiées
depuis Windows. **Les 59 produisent un SVG vectoriel valide** — testé une par
une, tracés confirmés, aucun `<text>` ni `font-family` résiduel.

Deux points relevés à cette occasion :

- **« Fredoka One » s'appelle désormais « Fredoka »** chez Google, et c'est une
  police variable (`Fredoka[wdth,wght].ttf`). Elle est déposée ici sous
  `FredokaOne.ttf`, le nom qu'utilise le configurateur. Les polices variables
  se vectorisent sans difficulté (leur instance par défaut est utilisée).

- **Dix polices** — dont Oswald, Roboto et Great Vibes — utilisent des tables
  de substitution qu'`opentype.js` ne sait pas lire : ses fonctions de haut
  niveau lèvent une exception. Le service bascule alors sur un parcours glyphe
  par glyphe (`charToGlyph`), qui les contourne. Mesuré sur Great Vibes : 418
  segments de Bézier, 13 contours — aucune perte de qualité.

  Ce repli abandonne les ligatures typographiques et le crénage contextuel.
  Sur du flocage (mots courts, souvent capitalisés), c'est imperceptible.
