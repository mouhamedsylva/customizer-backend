import { Injectable, Logger } from '@nestjs/common';
import * as opentype from 'opentype.js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TextSegmentData, RenderOptions } from './text-svg.service';

/**
 * Génère un SVG dont les lettres sont des TRACÉS (`<path>`), pas du texte.
 *
 * ── POURQUOI ──────────────────────────────────────────────────────────────
 *
 * L'atelier découpe du vinyle. Un plotter suit le CONTOUR des lettres : il lui
 * faut des tracés. Un PNG, même très haute définition, l'oblige à « vectoriser »
 * l'image — d'où des contours approximatifs et bavés. C'est la remarque du
 * client : « trop pixélisé pour être utilisable ». Ce n'est pas un problème de
 * résolution, c'est un problème de format, et aucun agrandissement ne le résout.
 *
 * ── CE QUE LA CONVERSION EN TRACÉS RÈGLE AU PASSAGE ───────────────────────
 *
 * Un `<text font-family="Anton">` ne contient pas la police : il la NOMME. Le
 * fichier dépend donc de ce qui est installé là où on l'ouvre. Le serveur n'a
 * que DejaVu (Dockerfile) face aux 58 Google Fonts du configurateur : tout
 * texte en sortait dans une police de substitution, sans le moindre
 * avertissement.
 *
 * Une fois les lettres transformées en tracés, elles ne dépendent plus
 * d'aucune police. Le fichier est autonome, chez nous comme chez le client.
 * Les .ttf ci-dessous ne servent qu'à la GÉNÉRATION.
 *
 * ── LE SVG DOIT ÊTRE CE QUE LE CLIENT A VU ────────────────────────────────
 *
 * Trois écarts avec l'écran existaient, tous corrigés ici :
 *
 * 1. GRAISSE. La boutique ne charge qu'UNE graisse par police (lien Google
 *    Fonts de layout/configurateur.liquid) : Lora, Dancing Script, Montserrat…
 *    n'existent à l'écran qu'en 700. Le serveur, lui, traçait l'instance par
 *    défaut du fichier — 400 pour Lora, 100 (Thin !) pour Montserrat. Voir
 *    `GRAISSES_BOUTIQUE` et `choisirFichier`.
 *
 * 2. BOÎTE. Largeur = avance typographique, hauteur = ascendante déclarée :
 *    les paraphes des scripts (Pacifico, Allura) dépassent l'avance et
 *    n'étaient sauvés que par la marge. On cadre maintenant sur le CONTOUR réel.
 *
 * 3. TAILLE. Le texte arrivait à sa taille écran (≈ 20 px, 8 px sur mobile)
 *    avec 32 px de marge fixe : des lettres de 20 px dans un cadre de 100, que
 *    le dashboard affichait en timbre-poste. La sortie est désormais mise à
 *    l'échelle (`TAILLE_MIN_SORTIE`), marge proportionnelle.
 */

/**
 * Graisses que la BOUTIQUE charge réellement, par police (clé normalisée).
 *
 * Recopié du lien Google Fonts de `Configurateur-travail/layout/
 * configurateur.liquid` : `family=Lora:wght@700` ⇒ `lora: [700]`. Une police
 * absente d'ici est chargée en 400 seul.
 *
 * Pourquoi c'est la référence, et pas le `fontWeight` envoyé : le navigateur ne
 * peut afficher QUE les graisses chargées. Un Lora demandé en 400 s'affiche en
 * 700, le seul disponible — c'est ce que le client voit et valide. Le
 * `fontWeight` envoyé (celui du style CSS) décrit l'intention, pas le rendu.
 *
 * ⚠ À tenir synchronisé avec le lien Google Fonts. `scripts/verif-polices.mjs`
 * signale tout écart.
 */
export const GRAISSES_BOUTIQUE: Readonly<Record<string, readonly number[]>> = {
  amaticsc: [700],
  caveat: [700],
  cinzel: [700],
  crimsontext: [700],
  dancingscript: [700],
  kalam: [700],
  lato: [700],
  librebaskerville: [700],
  lora: [700],
  merriweather: [700],
  montserrat: [700],
  nunito: [700],
  opensans: [700],
  oswald: [600],
  ptserif: [700],
  passionone: [700],
  playfairdisplay: [700],
  poppins: [700],
  raleway: [700],
  roboto: [700],
  tangerine: [700],
  teko: [600],
  ubuntu: [700],
};

/**
 * Noms de police demandés → police réellement disponible.
 *
 * « Bebas » a été proposée par le configurateur alors qu'elle n'existe pas
 * chez Google Fonts : seule « Bebas Neue » existe. Elle est retirée du
 * thème (septembre 2026) ; l'alias sert une page restée ouverte avec
 * l'ancienne liste, qui obtient ainsi son SVG au lieu du PNG seul.
 */
const ALIAS_POLICES: Readonly<Record<string, string>> = {
  bebas: 'bebasneue',
};

/**
 * Hauteur minimale du corps de texte dans le fichier produit, en unités SVG.
 *
 * Un tracé n'a pas de résolution, mais `width`/`height` fixent la taille
 * d'affichage par défaut : trop petits, les visionneuses (dashboard, aperçu
 * Windows) montrent un timbre-poste. Le PNG, rendu depuis ce SVG, en tire
 * aussi sa définition.
 */
const TAILLE_MIN_SORTIE = 200;

/** Marge autour du contour, en fraction du corps de texte. */
const MARGE_RELATIVE = 0.12;

/**
 * Pente de l'italique SYNTHÉTIQUE des navigateurs (Chrome/Skia : skewX −¼).
 * Aucune police n'est chargée en italique : le navigateur penche la romaine.
 */
const PENTE_ITALIQUE = 0.25;

/** Une variante de police : un fichier, une plage de graisses. */
type Variante = {
  chemin: string;
  /** Graisse fixe (police statique) ou plage (police variable). */
  min: number;
  max: number;
  variable: boolean;
};

/** Ce qu'opentype.js 2 expose mais que @types/opentype.js (v1) ignore. */
type PoliceV2 = opentype.Font & {
  variation?: {
    getTransform(glyph: opentype.Glyph, coords: Record<string, number>): opentype.Glyph;
  };
  position?: {
    getDefaultScriptName(): string;
    getKerningTables(script: string, language?: string): unknown;
    getKerningValue(tables: unknown, gauche: number, droite: number): number;
  };
  tables: Record<string, any>;
};

/** Police chargée, prête à tracer à une graisse donnée. */
type PoliceChargee = {
  police: PoliceV2;
  /** Coordonnées de variation (`{ wght: 700 }`), ou null pour une statique. */
  coords: Record<string, number> | null;
  /** Graisse effectivement tracée, pour le journal et la vérification. */
  graisse: number;
};

@Injectable()
export class TextOutlineService {
  private readonly logger = new Logger(TextOutlineService.name);

  /** Dossier des .ttf sources. Hors de `dist/`, donc chemin depuis la racine. */
  private readonly dossierPolices = join(process.cwd(), 'assets', 'fonts');

  /**
   * Fichiers déjà analysés, par chemin.
   *
   * Un .ttf fait de 50 ko à plusieurs Mo et son analyse n'est pas gratuite :
   * sans ce cache, chaque texte commandé relirait le fichier.
   */
  private readonly cache = new Map<string, PoliceV2>();

  /** Vrai une fois le dossier parcouru avec succès. */
  private indexPret = false;

  /** Nom de police normalisé -> ses variantes (Regular, Bold, variable…). */
  private readonly index = new Map<string, Variante[]>();

  /**
   * Construit l'index des polices disponibles en parcourant le dossier.
   *
   * On indexe les NOMS DE FICHIERS plutôt qu'une liste codée en dur : ajouter
   * une police au configurateur ne doit demander que de déposer son .ttf ici.
   * Le suffixe de style (`-Bold`, `-SemiBold`…) donne la graisse du fichier.
   */
  private async construireIndex(): Promise<void> {
    if (this.indexPret) return;

    let fichiers: string[];
    try {
      fichiers = await readdir(this.dossierPolices);
    } catch {
      /* Pas de `indexPret = true` ici : un démarrage depuis le mauvais
         dossier ne doit pas condamner la vectorisation jusqu'au redémarrage. */
      this.logger.error(
        `Dossier de polices introuvable (${this.dossierPolices}). ` +
          'Les textes ne pourront pas être vectorisés : déposez-y les .ttf ' +
          'des polices proposées par le configurateur.',
      );
      return;
    }

    for (const fichier of fichiers) {
      if (!/\.(ttf|otf)$/i.test(fichier)) continue;
      const base = fichier.replace(/\.(ttf|otf)$/i, '');
      const chemin = join(this.dossierPolices, fichier);

      /* « Anton-Regular.ttf », « AntonRegular.ttf » et « anton.ttf » doivent
         tous répondre à la demande « Anton » ; « Lato-Bold.ttf » aussi, comme
         variante 700. */
      /* Séparateur OBLIGATOIRE avant le suffixe, sauf « Regular » : sans lui,
         « ArchivoBlack.ttf » deviendrait la famille « Archivo » en 900. */
      const style = base.match(
        /(?:[-_ ](thin|extralight|light|regular|medium|semibold|bold|extrabold|black)|(regular))$/i,
      );
      const famille = this.normaliser(style ? base.slice(0, style.index) : base);
      const graisse = style ? GRAISSE_PAR_STYLE[(style[1] || style[2]).toLowerCase()] : 400;

      const variantes = this.index.get(famille) ?? [];
      variantes.push({ chemin, min: graisse, max: graisse, variable: false });
      this.index.set(famille, variantes);
    }

    this.indexPret = true;
    this.logger.log(`${this.index.size} police(s) indexée(s) pour la vectorisation.`);
  }

  /** Minuscules, sans espaces ni ponctuation : « Press Start 2P » -> « pressstart2p ». */
  private normaliser(nom: string): string {
    const cle = String(nom || '')
      .replace(/['"]/g, '')
      .split(',')[0]
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
    return ALIAS_POLICES[cle] ?? cle;
  }

  /** Lit et analyse un fichier (mis en cache), ou `null` s'il est illisible. */
  private async lireFichier(chemin: string): Promise<PoliceV2 | null> {
    const enCache = this.cache.get(chemin);
    if (enCache) return enCache;
    try {
      /* `opentype.load()` est déprécié depuis la v2 et ne renvoie plus la
         police : on lit le fichier et on l'analyse nous-mêmes.

         Le `slice` n'est pas décoratif — Node réutilise un même ArrayBuffer
         pour plusieurs Buffers (pooling), si bien que `buf.buffer` contient
         souvent bien plus que le fichier. Sans ce découpage, l'analyse porte
         sur des octets étrangers et échoue. */
      const buf = await readFile(chemin);
      const ab = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;
      const police = opentype.parse(ab) as PoliceV2;
      this.cache.set(chemin, police);
      return police;
    } catch (e) {
      this.logger.error(`Police illisible (${chemin}) : ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Graisse que le navigateur AFFICHE pour cette police et cette demande.
   *
   * Règle de sélection CSS (fonts.spec §5.2) appliquée aux seules graisses
   * chargées par la boutique. Avec une seule graisse chargée — le cas de
   * toutes nos polices — c'est toujours elle, quelle que soit la demande.
   */
  graisseAffichee(fontFamily: string, demandee: number): number {
    const chargees = GRAISSES_BOUTIQUE[this.normaliser(fontFamily)] ?? [400];
    return choisirGraisse(chargees, demandee);
  }

  /**
   * Charge une police à la graisse affichée en boutique, ou `null` si elle
   * n'est pas disponible.
   *
   * Renvoyer `null` plutôt que lever : une police manquante ne doit pas faire
   * échouer la commande. L'appelant retombe sur le PNG, qui reste produit.
   */
  private async chargerPolice(
    fontFamily: string,
    fontWeight?: string,
  ): Promise<PoliceChargee | null> {
    await this.construireIndex();

    const cle = this.normaliser(fontFamily);
    const variantes = this.index.get(cle);
    if (!variantes?.length) {
      this.logger.warn(
        `Police « ${fontFamily} » absente de ${this.dossierPolices} : ` +
          'ce texte ne sera pas vectorisé. Déposez le .ttf correspondant.',
      );
      return null;
    }

    /* La plage d'une police variable n'est connue qu'après analyse : on
       complète les variantes au premier chargement. */
    for (const v of variantes) {
      const police = await this.lireFichier(v.chemin);
      if (!police) continue;
      const axe = police.tables.fvar?.axes?.find((a: any) => a.tag === 'wght');
      /* Un fichier statique sans suffixe reste « 400 » : c'est le Regular de
         la famille. Sa table OS/2 n'est pas fiable pour ça — Archivo Black
         s'y déclare 900 alors que la boutique la charge comme 400. */
      if (axe) {
        v.variable = true;
        v.min = axe.minValue;
        v.max = axe.maxValue;
      }
    }

    const voulue = this.graisseAffichee(fontFamily, parseGraisse(fontWeight));
    const choisie = choisirFichier(variantes, voulue);
    const police = choisie && (await this.lireFichier(choisie.variante.chemin));
    if (!choisie || !police) return null;

    if (choisie.graisse !== voulue) {
      this.logger.warn(
        `Police « ${fontFamily} » : graisse ${voulue} affichée en boutique, ` +
          `${choisie.graisse} seulement disponible ici — le SVG sera plus ` +
          `${choisie.graisse < voulue ? 'fin' : 'épais'} que l'écran. ` +
          'Déposez le .ttf de la bonne graisse.',
      );
    }

    return {
      police,
      coords: choisie.variante.variable ? { wght: choisie.graisse } : null,
      graisse: choisie.graisse,
    };
  }

  /**
   * Fichier et graisse retenus pour une police — pour les scripts de
   * vérification (`scripts/verif-polices.mjs`), sans générer de SVG.
   */
  async diagnostiquer(
    fontFamily: string,
    fontWeight = '400',
  ): Promise<{ fichier: string; graisse: number; attendue: number } | null> {
    const chargee = await this.chargerPolice(fontFamily, fontWeight);
    if (!chargee) return null;
    const variantes = this.index.get(this.normaliser(fontFamily)) ?? [];
    const fichier = variantes.find((v) => this.cache.get(v.chemin) === chargee.police)?.chemin ?? '';
    return {
      fichier,
      graisse: chargee.graisse,
      attendue: this.graisseAffichee(fontFamily, parseGraisse(fontWeight)),
    };
  }

  /**
   * Toutes les polices demandées sont-elles disponibles ?
   *
   * Un SVG partiellement vectorisé serait pire que pas de SVG du tout :
   * l'atelier découperait une partie du texte sans s'apercevoir du reste.
   */
  async peutVectoriser(segments: TextSegmentData[]): Promise<boolean> {
    for (const segment of segments) {
      if (!(await this.chargerPolice(segment.fontFamily, segment.fontWeight))) return false;
    }
    return true;
  }

  /**
   * Produit le SVG en tracés, ou `null` si une police manque.
   *
   * @param segments segments de texte, déjà normalisés par TextSvgService
   * @param options  `scale` : agrandissement minimal (tailles écran → sortie).
   *                 Le corps de texte vaut au moins `TAILLE_MIN_SORTIE`.
   *                 `padding` est ignoré : la marge est proportionnelle au
   *                 corps (`MARGE_RELATIVE`), une marge fixe écrasait les
   *                 petits textes.
   */
  async genererSvgVectoriel(
    segments: TextSegmentData[],
    options: RenderOptions = { scale: 1, padding: 32 },
  ): Promise<string | null> {
    if (!segments?.length) return null;

    const polices: PoliceChargee[] = [];
    for (const segment of segments) {
      const chargee = await this.chargerPolice(segment.fontFamily, segment.fontWeight);
      if (!chargee) return null; // tout ou rien
      polices.push(chargee);
    }

    const tailleMax = Math.max(...segments.map((s) => s.fontSize));
    const echelle = Math.max(options.scale || 1, TAILLE_MIN_SORTIE / tailleMax);

    /* Mise en page sur une ligne de base à y = 0. Les segments s'enchaînent
       selon leur AVANCE (c'est ainsi que le navigateur les place), mais le
       cadre final se calcule sur le CONTOUR réel : les paraphes qui débordent
       de l'avance — Pacifico, Allura — ne sont plus rognés. */
    const formes: Array<{ chemin: opentype.Path; couleur: string }> = [];
    let x = 0;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const taille = segment.fontSize * echelle;
      const { chemin, avance } = this.disposer(
        polices[i],
        segment.text,
        x,
        taille,
        segment.fontStyle === 'italic',
      );
      formes.push({ chemin, couleur: segment.color });

      /* Soulignement : un vrai rectangle, pas `text-decoration` — cet attribut
         n'a aucun sens sur un tracé, et le plotter doit le découper aussi. */
      if (segment.underline) {
        const epaisseur = Math.max(1, taille * 0.05);
        const y = taille * 0.12;
        const trait = new opentype.Path();
        trait.moveTo(x, y);
        trait.lineTo(x + avance, y);
        trait.lineTo(x + avance, y + epaisseur);
        trait.lineTo(x, y + epaisseur);
        trait.close();
        formes.push({ chemin: trait, couleur: segment.color });
      }

      x += avance;
    }

    const cadre = new opentype.BoundingBox();
    for (const f of formes) {
      /* Un tracé vide (espace) a un cadre (0,0) et non « vide » : l'ignorer,
         sinon un texte d'espaces produisait un SVG vide au lieu de null. */
      if (!f.chemin.commands.length) continue;
      const b = f.chemin.getBoundingBox();
      if (!b.isEmpty()) {
        cadre.addPoint(b.x1, b.y1);
        cadre.addPoint(b.x2, b.y2);
      }
    }
    if (cadre.isEmpty()) return null; // que des espaces : rien à découper

    const marge = tailleMax * echelle * MARGE_RELATIVE;
    const dx = marge - cadre.x1;
    const dy = marge - cadre.y1;
    const largeurSvg = cadre.x2 - cadre.x1 + marge * 2;
    const hauteurSvg = cadre.y2 - cadre.y1 + marge * 2;

    const traces = formes
      .map((f) => {
        translater(f.chemin, dx, dy);
        const d = enDonneesSvg(f.chemin);
        return d ? `<path d="${d}" fill="${this.echapper(f.couleur)}"/>` : '';
      })
      .join('');

    /* Pas de fond : la découpe se fait sur du vinyle, un rectangle de fond
       serait découpé lui aussi. Le PNG, lui, garde sa transparence. */
    const w = this.arrondir(largeurSvg);
    const h = this.arrondir(hauteurSvg);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<!-- Lettres converties en tracés : ce fichier ne dépend d'aucune police. -->` +
      traces +
      `</svg>`;

    this.logger.debug(
      `SVG vectoriel : ${w}x${h}, ${segments.length} segment(s), ` +
        `graisse(s) ${polices.map((p) => p.graisse).join('/')}`,
    );
    return svg;
  }

  /**
   * Trace un texte glyphe par glyphe et renvoie son avance.
   *
   * On ne passe PAS par `Font.getPath` / `getAdvanceWidth`, pour trois raisons
   * mesurées :
   *
   * - `getAdvanceWidth` ignore la variation : Dancing Script donne la même
   *   largeur en 400 et en 700, alors que le 700 est 3 % plus large ;
   * - `getTransform` MODIFIE l'avance du glyphe en cache : mesure et tracé
   *   faits séparément se contredisaient selon l'ordre des appels ;
   * - sur dix polices (Lora, Oswald, Roboto, Great Vibes…) les tables de
   *   substitution font LEVER opentype.js. On retombe alors sur `charToGlyph`,
   *   sans ligatures — imperceptible sur des mots courts — mais on garde le
   *   crénage, qui passe par GPOS et non par GSUB.
   *
   * Une seule boucle mesure ET trace : les deux ne peuvent plus diverger.
   */
  private disposer(
    { police, coords }: PoliceChargee,
    texte: string,
    departX: number,
    taille: number,
    italique: boolean,
  ): { chemin: opentype.Path; avance: number } {
    const ratio = taille / police.unitsPerEm;

    let glyphes: opentype.Glyph[];
    try {
      glyphes = police.stringToGlyphs(texte);
    } catch {
      glyphes = Array.from(texte).map((c) => police.charToGlyph(c));
    }

    let tablesCrenage: unknown = null;
    try {
      const pos = police.position;
      tablesCrenage = pos ? pos.getKerningTables(pos.getDefaultScriptName()) : null;
    } catch {
      tablesCrenage = null;
    }
    const crenage = (a: opentype.Glyph, b: opentype.Glyph): number => {
      try {
        return tablesCrenage && police.position
          ? police.position.getKerningValue(tablesCrenage, a.index, b.index)
          : police.getKerningValue(a, b);
      } catch {
        return 0;
      }
    };

    const chemin = new opentype.Path();
    let x = departX;
    for (let i = 0; i < glyphes.length; i++) {
      const brut = glyphes[i];
      if (!brut) continue;
      const glyphe =
        coords && police.variation ? this.interpoler(police, brut, coords) : brut;

      /* Sans l'argument `font`, getPath trace le glyphe TEL QUEL (déjà
         transformé) au lieu de le re-transformer à la graisse par défaut. */
      const trace = glyphe.getPath(x, 0, taille, { xScale: ratio, yScale: ratio } as any);
      if (italique) pencher(trace);
      chemin.extend(trace);

      x += (glyphe.advanceWidth || 0) * ratio;
      if (i < glyphes.length - 1 && glyphes[i + 1]) {
        x += crenage(brut, glyphes[i + 1]) * ratio;
      }
    }

    return { chemin, avance: x - departX };
  }

  /**
   * Glyphe à la graisse voulue, ou le glyphe d'origine si l'interpolation
   * d'opentype.js déraille (glyphes composites : voir `choisirFichier`).
   * Mieux vaut une lettre un peu plus fine qu'une lettre explosée découpée.
   */
  private interpoler(
    police: PoliceV2,
    brut: opentype.Glyph,
    coords: Record<string, number>,
  ): opentype.Glyph {
    try {
      const glyphe = police.variation!.getTransform(brut, coords);
      const b = glyphe.path.getBoundingBox();
      const limite = police.unitsPerEm * 3;
      if (b.isEmpty() || (Math.abs(b.y1) < limite && Math.abs(b.y2) < limite &&
          Math.abs(b.x1) < limite && Math.abs(b.x2) < limite)) {
        return glyphe;
      }
    } catch {
      /* repli ci-dessous */
    }
    this.logger.warn(
      `Interpolation aberrante du glyphe « ${brut.name ?? brut.index} » : ` +
        'tracé à la graisse par défaut. Déposez un .ttf statique de la bonne graisse.',
    );
    return brut;
  }

  private arrondir(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /** Les couleurs viennent du client : elles finissent dans un attribut XML. */
  private echapper(valeur: string): string {
    return String(valeur ?? '#000000')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

const GRAISSE_PAR_STYLE: Record<string, number> = {
  thin: 100,
  extralight: 200,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
};

/** « bold » → 700, « 800 » → 800, vide → 400. */
export function parseGraisse(valeur: string | number | undefined): number {
  if (typeof valeur === 'number') return valeur;
  const v = String(valeur ?? '').trim().toLowerCase();
  if (v === 'bold' || v === 'bolder') return 700;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 400;
}

/**
 * Sélection CSS d'une graisse parmi celles disponibles (fonts.spec §5.2) :
 * - 400 demandé : 500, puis plus fin, puis plus épais ;
 * - moins de 400 : plus fin d'abord, puis plus épais ;
 * - plus de 500 : plus épais d'abord, puis plus fin.
 */
export function choisirGraisse(disponibles: readonly number[], voulue: number): number {
  if (disponibles.includes(voulue)) return voulue;
  const plusFins = disponibles.filter((g) => g < voulue).sort((a, b) => b - a);
  const plusEpais = disponibles.filter((g) => g > voulue).sort((a, b) => a - b);
  if (voulue >= 400 && voulue <= 500) {
    const jusqua500 = plusEpais.filter((g) => g <= 500);
    return jusqua500[0] ?? plusFins[0] ?? plusEpais[0];
  }
  if (voulue < 400) return plusFins[0] ?? plusEpais[0];
  return plusEpais[0] ?? plusFins[0];
}

/**
 * Variante qui rend `voulue`, par ordre de préférence :
 * 1. un fichier STATIQUE de cette graisse — l'instance que Google Fonts sert
 *    au navigateur, donc le dessin exact que le client a vu ;
 * 2. une police variable qui la couvre — interpolée par opentype.js, dont le
 *    moteur de variation est encore fragile : il fait exploser les glyphes
 *    COMPOSITES (le « é » de Merriweather 700 s'étendait sur 35 000 unités) ;
 * 3. la statique la plus proche, règle CSS.
 */
function choisirFichier(
  variantes: Variante[],
  voulue: number,
): { variante: Variante; graisse: number } | null {
  const exacte = variantes.find((v) => !v.variable && v.min === voulue);
  if (exacte) return { variante: exacte, graisse: voulue };

  const variable = variantes.find((v) => v.variable && v.min <= voulue && voulue <= v.max);
  if (variable) return { variante: variable, graisse: voulue };

  const candidates = variantes.flatMap((v) =>
    v.variable ? [{ v, g: v.min }, { v, g: v.max }] : [{ v, g: v.min }],
  );
  if (!candidates.length) return null;
  const graisse = choisirGraisse(candidates.map((c) => c.g), voulue);
  const c = candidates.find((x) => x.g === graisse)!;
  return { variante: c.v, graisse };
}

/** Applique `f` à chaque point (extrémités et poignées) d'un tracé. */
function transformerPoints(chemin: opentype.Path, f: (x: number, y: number) => [number, number]): void {
  for (const c of chemin.commands as any[]) {
    for (const [kx, ky] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) {
      if (typeof c[kx] === 'number') [c[kx], c[ky]] = f(c[kx], c[ky]);
    }
  }
}

function translater(chemin: opentype.Path, dx: number, dy: number): void {
  transformerPoints(chemin, (x, y) => [x + dx, y + dy]);
}

/**
 * Sérialise un tracé en attribut `d`, SANS `Path.toPathData` d'opentype.js.
 *
 * Son arrondi (`roundDecimal`) concatène la partie décimale à « e+2 » pour
 * arrondir : quand un calcul flottant laisse une décimale infime
 * (93.00000000000003 → 3e-14), la chaîne devient « 3e-14e+2 » et le résultat
 * NaN. Un seul NaN dans `d` et le navigateur ARRÊTE de dessiner le tracé à cet
 * endroit : il ne reste qu'un fragment de lettre. Mesuré sur « Martin » avec
 * l'ancien code : 11 NaN en Lora 20 px, 8 en Allura 20 px, 3 en Pacifico
 * 28 px… — la « petite forme noire » des aperçus SVG du dashboard.
 */
export function enDonneesSvg(chemin: opentype.Path): string {
  const n = (v: number): string => {
    const r = Math.round(v * 100) / 100;
    if (!Number.isFinite(r)) throw new Error(`Coordonnée invalide dans un tracé : ${v}`);
    return String(Object.is(r, -0) ? 0 : r);
  };
  let d = '';
  for (const c of chemin.commands as any[]) {
    switch (c.type) {
      case 'M':
      case 'L':
        d += `${c.type}${n(c.x)} ${n(c.y)}`;
        break;
      case 'Q':
        d += `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
        break;
      case 'C':
        d += `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
        break;
      case 'Z':
        d += 'Z';
        break;
    }
  }
  return d;
}

/** Italique synthétique, autour de la ligne de base (y = 0, y vers le bas). */
function pencher(chemin: opentype.Path): void {
  transformerPoints(chemin, (x, y) => [x - y * PENTE_ITALIQUE, y]);
}
