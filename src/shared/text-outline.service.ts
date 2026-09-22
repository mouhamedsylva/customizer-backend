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
 * ── EFFET SECONDAIRE UTILE ────────────────────────────────────────────────
 *
 * opentype.js donne la largeur RÉELLE de chaque tracé. L'ancien calcul
 * estimait `nombre de caractères × 0,6 × taille` — une approximation monospace
 * appliquée à des polices proportionnelles, d'où des textes rognés et des
 * segments qui se chevauchaient.
 */
@Injectable()
export class TextOutlineService {
  private readonly logger = new Logger(TextOutlineService.name);

  /** Dossier des .ttf sources. Hors de `dist/`, donc chemin depuis la racine. */
  private readonly dossierPolices = join(process.cwd(), 'assets', 'fonts');

  /**
   * Polices déjà lues, indexées par nom normalisé.
   *
   * Un .ttf fait de 50 ko à plusieurs Mo et son analyse n'est pas gratuite :
   * sans ce cache, chaque texte commandé relirait le fichier.
   */
  private readonly cache = new Map<string, opentype.Font>();

  /** Vrai une fois le dossier parcouru (une seule fois par processus). */
  private indexPret = false;

  /** Nom de police normalisé -> chemin du fichier. */
  private readonly index = new Map<string, string>();

  /**
   * Construit l'index des polices disponibles en parcourant le dossier.
   *
   * On indexe les NOMS DE FICHIERS plutôt qu'une liste codée en dur : ajouter
   * une police au configurateur ne doit demander que de déposer son .ttf ici.
   * Une liste en dur se serait désynchronisée au premier ajout.
   */
  private async construireIndex(): Promise<void> {
    if (this.indexPret) return;
    this.indexPret = true; // même en cas d'échec : on ne réessaie pas à chaque texte

    let fichiers: string[];
    try {
      fichiers = await readdir(this.dossierPolices);
    } catch {
      this.logger.error(
        `Dossier de polices introuvable (${this.dossierPolices}). ` +
          'Les textes ne pourront pas être vectorisés : déposez-y les .ttf ' +
          'des polices proposées par le configurateur.',
      );
      return;
    }

    for (const fichier of fichiers) {
      if (!/\.(ttf|otf)$/i.test(fichier)) continue;
      /* « Anton-Regular.ttf », « AntonRegular.ttf » et « anton.ttf » doivent
         tous répondre à la demande « Anton ». */
      const base = fichier.replace(/\.(ttf|otf)$/i, '');
      this.index.set(this.normaliser(base), join(this.dossierPolices, fichier));

      const sansStyle = base.replace(/[-_ ]?(regular|bold|italic|black)$/i, '');
      const cle = this.normaliser(sansStyle);
      if (!this.index.has(cle)) {
        this.index.set(cle, join(this.dossierPolices, fichier));
      }
    }

    this.logger.log(`${this.index.size} police(s) indexée(s) pour la vectorisation.`);
  }

  /** Minuscules, sans espaces ni ponctuation : « Press Start 2P » -> « pressstart2p ». */
  private normaliser(nom: string): string {
    return String(nom || '')
      .replace(/['"]/g, '')
      .split(',')[0]
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
  }

  /**
   * Charge une police, ou `null` si elle n'est pas disponible.
   *
   * Renvoyer `null` plutôt que lever : une police manquante ne doit pas faire
   * échouer la commande. L'appelant retombe sur le PNG, qui reste produit.
   */
  private async chargerPolice(fontFamily: string): Promise<opentype.Font | null> {
    await this.construireIndex();

    const cle = this.normaliser(fontFamily);
    const enCache = this.cache.get(cle);
    if (enCache) return enCache;

    const chemin = this.index.get(cle);
    if (!chemin) {
      this.logger.warn(
        `Police « ${fontFamily} » absente de ${this.dossierPolices} : ` +
          'ce texte ne sera pas vectorisé. Déposez le .ttf correspondant.',
      );
      return null;
    }

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
      const police = opentype.parse(ab);
      this.cache.set(cle, police);
      return police;
    } catch (e) {
      this.logger.error(
        `Police « ${fontFamily} » illisible (${chemin}) : ${(e as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Toutes les polices demandées sont-elles disponibles ?
   *
   * Un SVG partiellement vectorisé serait pire que pas de SVG du tout :
   * l'atelier découperait une partie du texte sans s'apercevoir du reste.
   */
  async peutVectoriser(segments: TextSegmentData[]): Promise<boolean> {
    for (const segment of segments) {
      if (!(await this.chargerPolice(segment.fontFamily))) return false;
    }
    return true;
  }

  /**
   * Produit le SVG en tracés, ou `null` si une police manque.
   *
   * @param segments segments de texte, déjà normalisés par TextSvgService
   * @param options  `scale` est ignoré : un tracé n'a pas de résolution. Seul
   *                 `padding` compte, pour la marge autour du texte.
   */
  async genererSvgVectoriel(
    segments: TextSegmentData[],
    options: RenderOptions = { scale: 1, padding: 32 },
  ): Promise<string | null> {
    if (!segments?.length) return null;

    const padding = Math.max(0, options.padding ?? 32);

    /* Passe 1 : mesurer.
       Les dimensions du SVG doivent être connues avant d'écrire les tracés,
       et les tracés dépendent de la position de base. D'où deux passes. */
    type Mesure = {
      segment: TextSegmentData;
      police: opentype.Font;
      largeur: number;
      hauteurAuDessus: number; // au-dessus de la ligne de base
      hauteurEnDessous: number; // jambages du p, g, j…
    };
    const mesures: Mesure[] = [];

    for (const segment of segments) {
      const police = await this.chargerPolice(segment.fontFamily);
      if (!police) return null; // tout ou rien

      const taille = segment.fontSize;
      /* unitsPerEm : la police définit ses contours dans sa propre grille.
         Ce rapport la ramène en pixels. */
      const ratio = taille / police.unitsPerEm;

      /* `getAdvanceWidth` traverse les tables de substitution de la police
         (ligatures, formes contextuelles). opentype.js ne les gère pas toutes
         et LÈVE sur certaines — « substitutionType 62 lookupType 6 » sur une
         police de ce catalogue, par exemple.

         Sans cette protection, une seule police exotique faisait échouer la
         génération, donc l'ajout au panier : le client restait bloqué au
         paiement à cause d'un fichier destiné à l'atelier. On abandonne la
         vectorisation pour ce texte, et le PNG suffit. */
      let largeur: number;
      try {
        largeur = police.getAdvanceWidth(segment.text, taille);
      } catch {
        /* Repli glyphe par glyphe — voir `largeurParGlyphes`. */
        largeur = this.largeurParGlyphes(police, segment.text, taille);
      }

      mesures.push({
        segment,
        police,
        largeur,
        hauteurAuDessus: police.ascender * ratio,
        hauteurEnDessous: Math.abs(police.descender) * ratio,
      });
    }

    const largeurTexte = mesures.reduce((somme, m) => somme + m.largeur, 0);
    const auDessus = Math.max(...mesures.map((m) => m.hauteurAuDessus));
    const enDessous = Math.max(...mesures.map((m) => m.hauteurEnDessous));

    const largeurSvg = largeurTexte + padding * 2;
    const hauteurSvg = auDessus + enDessous + padding * 2;

    /* Ligne de base : les jambages descendent en dessous, il faut leur laisser
       la place sous peine de les rogner. */
    const ligneDeBase = padding + auDessus;

    // Passe 2 : écrire les tracés.
    const tracés: string[] = [];
    let x = padding;

    for (const m of mesures) {
      const { segment, police } = m;

      // Même traversée des tables de substitution qu'à la mesure : même repli.
      let d: string;
      try {
        const chemin = police.getPath(
          segment.text,
          x,
          ligneDeBase,
          segment.fontSize,
        );
        d = chemin.toPathData(2); // 2 décimales : assez pour une découpe
      } catch {
        d = this.tracéParGlyphes(
          police,
          segment.text,
          x,
          ligneDeBase,
          segment.fontSize,
        );
      }

      if (d) {
        tracés.push(
          `<path d="${d}" fill="${this.echapper(segment.color)}"/>`,
        );
      }

      /* Soulignement : un vrai rectangle, pas `text-decoration` — cet attribut
         n'a aucun sens sur un tracé, et le plotter doit le découper aussi. */
      if (segment.underline) {
        const epaisseur = Math.max(1, segment.fontSize * 0.05);
        const y = ligneDeBase + segment.fontSize * 0.12;
        tracés.push(
          `<rect x="${this.arrondir(x)}" y="${this.arrondir(y)}" ` +
            `width="${this.arrondir(m.largeur)}" height="${this.arrondir(epaisseur)}" ` +
            `fill="${this.echapper(segment.color)}"/>`,
        );
      }

      x += m.largeur;
    }

    /* Pas de fond : la découpe se fait sur du vinyle, un rectangle de fond
       serait découpé lui aussi. Le PNG, lui, garde sa transparence. */
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `width="${this.arrondir(largeurSvg)}" height="${this.arrondir(hauteurSvg)}" ` +
      `viewBox="0 0 ${this.arrondir(largeurSvg)} ${this.arrondir(hauteurSvg)}">` +
      `<!-- Lettres converties en tracés : ce fichier ne dépend d'aucune police. -->` +
      tracés.join('') +
      `</svg>`;

    this.logger.debug(
      `SVG vectoriel : ${this.arrondir(largeurSvg)}x${this.arrondir(hauteurSvg)}, ` +
        `${segments.length} segment(s)`,
    );
    return svg;
  }

  /* ── REPLI GLYPHE PAR GLYPHE ──────────────────────────────────────────────
   *
   * `getAdvanceWidth` et `getPath` traversent les tables de substitution de la
   * police (ligatures, formes contextuelles). opentype.js ne les gère pas
   * toutes et LÈVE — « substitutionType 62 lookupType 6 » — sur dix polices du
   * catalogue, dont Oswald, Roboto et Great Vibes, parmi les plus demandées.
   *
   * `charToGlyph` va chercher le glyphe directement dans la table de
   * caractères, sans passer par ces substitutions. Mesuré : les dix polices
   * sortent alors des tracés corrects.
   *
   * Ce que l'on perd : les ligatures typographiques (le « fi » lié) et le
   * crénage contextuel. Sur du flocage — des mots courts, souvent en
   * capitales — c'est imperceptible, et très préférable à l'absence de
   * fichier de découpe.
   */

  /** Largeur d'un texte, glyphe par glyphe. */
  private largeurParGlyphes(
    police: opentype.Font,
    texte: string,
    taille: number,
  ): number {
    const ratio = taille / police.unitsPerEm;
    let largeur = 0;
    for (const caractère of texte) {
      const glyphe = police.charToGlyph(caractère);
      largeur += (glyphe?.advanceWidth || 0) * ratio;
    }
    return largeur;
  }

  /** Tracé d'un texte, glyphe par glyphe, positionné à la main. */
  private tracéParGlyphes(
    police: opentype.Font,
    texte: string,
    départX: number,
    ligneDeBase: number,
    taille: number,
  ): string {
    const ratio = taille / police.unitsPerEm;
    let d = '';
    let x = départX;
    for (const caractère of texte) {
      const glyphe = police.charToGlyph(caractère);
      if (!glyphe) continue;
      d += glyphe.getPath(x, ligneDeBase, taille).toPathData(2);
      x += (glyphe.advanceWidth || 0) * ratio;
    }
    return d;
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
