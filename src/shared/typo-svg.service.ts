import { Injectable, Logger } from '@nestjs/common';
import * as opentype from 'opentype.js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Retrouve la typo d'un texte À PARTIR DE SON SVG DE DÉCOUPE.
 *
 * ── POURQUOI ──────────────────────────────────────────────────────────────
 *
 * Les commandes passées avant septembre 2026 n'ont aucune propriété `_Texte*` :
 * police, taille et couleur choisies par le client n'ont été enregistrées
 * nulle part. Seul reste le fichier « Texte face (SVG) ».
 *
 * Or ce SVG a été produit par NOTRE service, à partir des .ttf de
 * `assets/fonts` : chaque lettre y est le contour EXACT d'un glyphe, mis à
 * l'échelle et décalé. Comparer ces contours à ceux de nos polices redonne la
 * police, la taille, le texte, la couleur (`fill`) et le soulignement
 * (`<rect>`). Le gras et l'italique, que l'ancien code ignorait, ne se
 * retrouvent pas.
 *
 * ── PRINCIPE ──────────────────────────────────────────────────────────────
 *
 * Un `<path>` par segment de texte. Son premier contour est comparé au premier
 * contour de chaque caractère candidat, de chaque police : l'échelle se déduit
 * du rapport des cadres, puis TOUS les points doivent coïncider. La police
 * trouvée, les contours suivants sont lus glyphe par glyphe ; l'écart entre
 * deux lettres, rapporté à la chasse de l'espace, redonne les espaces.
 *
 * Tout ou rien : si un seul contour reste inexpliqué, on renvoie `null`.
 * Une typo fausse affichée à l'atelier serait pire que pas de typo.
 */

export interface SegmentRetrouve {
  texte: string;
  police: string;
  taillePx: number;
  couleur: string;
  souligne: boolean;
}

export interface TypoRetrouvee extends SegmentRetrouve {
  /** Tous les segments, quand le texte en mêlait plusieurs. */
  segments: SegmentRetrouve[];
  source: 'svg';
}

type Commande = { type: string; pts: number[] };
type Contour = Commande[];

type Candidat = {
  car: string;
  glyphe: opentype.Glyph;
  /** Contours du glyphe à la taille unitsPerEm (1 unité = 1 px). */
  contours: Contour[];
  cadre: { w: number; h: number };
};

type Police = {
  nom: string;
  font: opentype.Font;
  candidats: Candidat[];
  espace: number; // chasse de l'espace, en unités
};

/** Caractères cherchés : ce qu'un client tape sur un vêtement. */
const JEU =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
  'ÀÂÄÆÇÉÈÊËÎÏÔŒÙÛÜŸàâäæçéèêëîïôœùûüÿñÑ' +
  "&'’-–.,;:!?()/+@#\"«»€$%*_=<>[]";

/** Noms d'affichage des polices archivées (le nom du fichier d'origine). */
const NOMS_ARCHIVES: Record<string, string> = { fredokaone: 'Fredoka One' };

@Injectable()
export class TypoSvgService {
  private readonly logger = new Logger(TypoSvgService.name);
  private readonly dossier = join(process.cwd(), 'assets', 'fonts');
  private polices: Police[] | null = null;

  /**
   * Les polices telles que l'ANCIEN code les utilisait : le fichier sans
   * suffixe de chaque famille (les -Bold sont postérieurs), à son instance par
   * défaut, et les fichiers remplacés depuis, archivés dans `anciennes/`.
   */
  private async chargerPolices(): Promise<Police[]> {
    if (this.polices) return this.polices;

    const fichiers = new Map<string, string>();
    for (const f of await readdir(this.dossier)) {
      if (/\.(ttf|otf)$/i.test(f) && !/-[a-z]+\.(ttf|otf)$/i.test(f)) {
        fichiers.set(f.replace(/\.(ttf|otf)$/i, '').toLowerCase(), join(this.dossier, f));
      }
    }
    try {
      for (const f of await readdir(join(this.dossier, 'anciennes'))) {
        if (/\.(ttf|otf)$/i.test(f)) {
          fichiers.set(f.replace(/\.(ttf|otf)$/i, '').toLowerCase(), join(this.dossier, 'anciennes', f));
        }
      }
    } catch {
      /* pas d'archive : rien à remplacer */
    }

    const polices: Police[] = [];
    for (const [cle, chemin] of fichiers) {
      try {
        const buf = await readFile(chemin);
        const font = opentype.parse(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
        );
        /* opentype.js 2 range les noms par plateforme (windows, macintosh). */
        const tables: any = font.names;
        const lire = (cleNom: string): string | undefined => {
          for (const t of [tables.windows, tables.macintosh, tables.unicode, tables]) {
            const v = t?.[cleNom]?.en;
            if (v) return v;
          }
          return undefined;
        };
        const nom =
          NOMS_ARCHIVES[cle] ||
          lire('preferredFamily') || lire('typographicFamily') || lire('fontFamily') || cle;
        polices.push({
          nom,
          font,
          candidats: this.candidats(font),
          espace: font.charToGlyph(' ')?.advanceWidth || font.unitsPerEm * 0.25,
        });
      } catch (e) {
        this.logger.warn(`Police ignorée (${chemin}) : ${(e as Error).message}`);
      }
    }
    this.polices = polices;
    return polices;
  }

  /** Contours de chaque caractère du jeu, et des ligatures nommées (f_i…). */
  private candidats(font: opentype.Font): Candidat[] {
    const vus = new Set<number>();
    const out: Candidat[] = [];
    const ajouter = (car: string, glyphe: opentype.Glyph | undefined) => {
      if (!glyphe || glyphe.index === 0 || vus.has(glyphe.index)) return;
      const contours = this.contoursDuGlyphe(font, glyphe);
      if (!contours.length) return;
      vus.add(glyphe.index);
      out.push({ car, glyphe, contours, cadre: cadre(contours[0]) });
    };
    for (const car of JEU) ajouter(car, font.charToGlyph(car));
    /* Ligatures : l'ancien code passait par getPath, qui les applique. */
    for (let i = 0; i < font.glyphs.length; i++) {
      const g = font.glyphs.get(i);
      const m = /^([a-z]+(?:_[a-z]+)+)(\.liga)?$/i.exec(g.name || '');
      if (m) ajouter(m[1].replace(/_/g, ''), g);
    }
    return out;
  }

  /**
   * Contours du glyphe à la taille unitsPerEm, origine (0, 0), sérialisés
   * comme l'ancien code (`toPathData(2)`, qui simplifie certains segments).
   */
  private contoursDuGlyphe(font: opentype.Font, glyphe: opentype.Glyph): Contour[] {
    const p = (glyphe as any).getPath(0, 0, font.unitsPerEm, {}, font) as opentype.Path;
    return lireContours(p.toPathData({ decimalPlaces: 4, flipY: false, optimize: false } as any));
  }

  /**
   * Le glyphe redessiné À LA TAILLE du SVG, sérialisé par le même
   * `toPathData` que l'ancien code : ses simplifications (segment de
   * fermeture à moins d'1 px, doublons) dépendent de la taille en pixels et
   * ne se reproduisent qu'ainsi. Deux variantes, les deux chemins de l'ancien
   * code : `Font.getPath` (variation appliquée) et le repli glyphe par glyphe
   * (`Glyph.getPath` sans police), pris pour Lora, Oswald, Roboto…
   */
  private readonly exacts = new Map<string, Contour[][]>();
  private exact(font: opentype.Font, c: Candidat, taille: number): Contour[][] {
    const cle = `${(font as any).__id ??= Math.random()}|${c.glyphe.index}|${taille}`;
    let v = this.exacts.get(cle);
    if (!v) {
      const opts = { decimalPlaces: 6, flipY: false } as any;
      /* `toPathData` retire le dernier segment droit d'un contour s'il n'est
         suivi de RIEN (ou d'un Z). Dans l'ancien SVG, la lettre suivante
         venait après : on reproduit les deux situations (dernière lettre du
         texte ou non) avec une commande factice en fin de tracé. */
      const serialiser = (p: opentype.Path, suivie: boolean): string => {
        if (suivie) p.commands.push({ type: 'M', x: 0, y: 0 } as any);
        return p.toPathData(opts);
      };
      const variantes = new Set<string>();
      for (const suivie of [false, true]) {
        variantes.add(serialiser((c.glyphe as any).getPath(0, 0, taille, {}, font), suivie));
        variantes.add(serialiser(c.glyphe.getPath(0, 0, taille), suivie));
      }
      v = [...variantes].map(lireContours);
      if (this.exacts.size > 50000) this.exacts.clear();
      this.exacts.set(cle, v);
    }
    return v;
  }

  /** Correspondance stricte : l'une des variantes exactes coïncide point à point. */
  private coincideExact(svg: Contour[], i: number, font: opentype.Font, c: Candidat, taille: number): boolean {
    return this.origineExacte(svg, i, font, c, taille) !== null;
  }

  /** Abscisse de l'origine du glyphe dans le SVG s'il coïncide, sinon null. */
  private origineExacte(svg: Contour[], i: number, font: opentype.Font, c: Candidat, taille: number): number | null {
    for (const v of this.exact(font, c, taille)) {
      if (v.length !== c.contours.length || !strict(svg, i, v)) continue;
      const ancrage = ancre(sansSegmentsNuls(svg[i]), sansSegmentsNuls(v[0]));
      if (ancrage) return ancrage[0] - ancrage[2]; // la variante est tracée en x = 0
    }
    return null;
  }

  /** Typo d'un SVG de découpe, ou null s'il n'est pas identifiable à coup sûr. */
  async identifier(svg: string): Promise<TypoRetrouvee | null> {
    const chemins = [...svg.matchAll(/<path\b[^>]*?\sd="([^"]*)"[^>]*?(?:\sfill="([^"]*)")?[^>]*>/g)];
    if (!chemins.length) return null;
    const rects = [...svg.matchAll(/<rect\b[^>]*\sx="([-\d.]+)"[^>]*\swidth="([-\d.]+)"/g)].map(
      (m) => ({ x1: +m[1], x2: +m[1] + +m[2] }),
    );

    const polices = await this.chargerPolices();
    const segments: SegmentRetrouve[] = [];
    let texteAvant = '';
    let finPrecedente: number | null = null;

    /* Un seul segment : la hauteur du SVG donne directement la taille pour
       chaque police (ancienne formule : ascendante + descendante + 2 × 32 de
       marge). La recherche n'essaie alors que les glyphes compatibles —
       plusieurs secondes gagnées par SVG. Sans résultat (autre marge…), on
       refait la recherche complète. */
    const hauteur = Number(/<svg\b[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1]);
    const unSeul = chemins.length === 1 && Number.isFinite(hauteur) ? hauteur : null;

    for (const [, d, fill] of chemins) {
      const contours = lireContours(d);
      if (!contours.length) continue;
      const seg =
        (unSeul !== null ? this.lireSegment(contours, polices, unSeul) : null) ??
        this.lireSegment(contours, polices);
      if (!seg) return null;

      /* Espaces ENTRE segments : écart à la fin du segment précédent. */
      if (finPrecedente !== null) {
        const n = Math.round((seg.debut - finPrecedente) / (seg.espacePx || 1));
        if (n > 0) texteAvant += ' '.repeat(Math.min(n, 5));
      }
      finPrecedente = seg.fin;

      const souligne = rects.some((r) => r.x1 < seg.fin && r.x2 > seg.debut);
      segments.push({
        texte: (segments.length ? texteAvant : '') + seg.texte,
        police: seg.police,
        taillePx: seg.taillePx,
        couleur: fill || '#000000',
        souligne,
      });
      texteAvant = '';
    }
    if (!segments.length) return null;

    return {
      ...segments[0],
      texte: segments.map((s) => s.texte).join(''),
      souligne: segments.some((s) => s.souligne),
      segments,
      source: 'svg',
    };
  }

  /** Un segment : police et échelle par son 1er contour, puis lecture glyphe à glyphe. */
  private lireSegment(
    contours: Contour[],
    polices: Police[],
    hauteurSvg?: number,
  ): { texte: string; police: string; taillePx: number; debut: number; fin: number; espacePx: number } | null {
    const premier = cadre(contours[0]);

    for (const police of polices) {
      const upm = police.font.unitsPerEm;
      /* Taille imposée par la hauteur du SVG (un seul segment), si connue. */
      const tailleH = hauteurSvg
        ? ((hauteurSvg - 64) * upm) / (police.font.ascender + Math.abs(police.font.descender))
        : null;
      if (tailleH !== null && !(tailleH >= 1 && tailleH <= 300)) continue;

      for (const c of police.candidats) {
        if (c.contours.length > contours.length) continue;
        if (!structureProche(contours, 0, c)) continue;
        /* Échelles approchées, de la plus fiable à la moins fiable : les NaN
           du bug d'arrondi tombent souvent sur les points extrêmes et
           faussent le cadre ; à une échelle trop fausse, les simplifications
           de toPathData (seuil d'1 px) changent la structure du tracé. */
        const parCadre = premier.h / c.cadre.h;
        if (tailleH !== null && Math.abs(parCadre * upm - tailleH) > tailleH * 0.05) continue;
        const approxs = [
          ...(tailleH !== null ? [tailleH / upm] : []),
          parCadre,
          premier.w / c.cadre.w,
          echelleOptimale(contours[0], c.contours[0], parCadre) ?? NaN,
        ].filter((a) => Number.isFinite(a) && a > 0 && a * upm >= 1 && a * upm <= 300);
        if (!approxs.length) continue;

        let taille = 0;
        let ok = false;
        chercher: for (const approx of approxs) {
          /* Affinage sur le tracé EXACT à l'échelle approchée (même structure). */
          for (const v of this.exact(police.font, c, approx * upm)) {
            const f = facteurEchelle(contours[0], v[0]);
            /* Un facteur négatif est une rotation de 180° : le « n » de Russo
               One retourné coïncide avec son « u ». Seule une correction
               modeste de l'échelle approchée a du sens. */
            if (f === null || f < 0.5 || f > 2) continue;
            const t0 = approx * f * upm;
            /* Les tailles CSS sont presque toujours au dixième : l'arrondi
               d'abord, il supprime l'erreur résiduelle. */
            for (const t of [Math.round(t0 * 10) / 10, t0]) {
              if (this.coincideExact(contours, 0, police.font, c, t)) {
                taille = t;
                ok = true;
                break chercher;
              }
            }
          }
        }
        if (!ok) continue;
        const s = taille / upm;

        const lu = this.lireGlyphes(contours, police, s);
        if (lu) {
          return {
            ...lu,
            police: police.nom,
            taillePx: Math.round(taille * 10) / 10,
            espacePx: police.espace * s,
          };
        }
      }
    }
    return null;
  }

  /** Lit tous les contours avec une police et une échelle données. */
  private lireGlyphes(
    contours: Contour[],
    police: Police,
    s: number,
  ): { texte: string; debut: number; fin: number } | null {
    let i = 0;
    let texte = '';
    let debut = NaN;
    let finAttendue: number | null = null;

    while (i < contours.length) {
      /* Le plus long l'emporte : « é » (2 contours) avant « e » (1). À dessin
         IDENTIQUE — « l » et « I » d'Oswald —, la casse du voisin tranche :
         minuscule après une minuscule, majuscule sinon. */
      const precedent = texte.trim().slice(-1);
      const apresMinuscule = !!precedent && precedent !== precedent.toUpperCase();
      /* Même logique pour « 0 » et « O » (Bebas Neue) : chiffre après un chiffre. */
      const apresChiffre = /\d/.test(precedent);
      const note = (c: Candidat) => {
        const minuscule = c.car !== c.car.toUpperCase();
        const majuscule = c.car !== c.car.toLowerCase();
        const chiffre = /\d/.test(c.car);
        return c.contours.length * 10 +
          (apresChiffre && chiffre ? 2 : 0) +
          ((apresMinuscule && minuscule) || (!apresMinuscule && !apresChiffre && majuscule) ? 1 : 0);
      };
      let trouve: Candidat | null = null;
      for (const c of police.candidats) {
        if (i + c.contours.length > contours.length) continue;
        if (
          (!trouve || note(c) > note(trouve)) &&
          structureProche(contours, i, c) &&
          this.coincideExact(contours, i, police.font, c, s * police.font.unitsPerEm)
        ) {
          trouve = c;
        }
      }
      if (!trouve) return null;

      /* Origine du glyphe : 1er point du SVG moins le 1er point du glyphe. */
      const origine = this.origineExacte(contours, i, police.font, trouve, s * police.font.unitsPerEm)!;
      if (Number.isNaN(debut)) debut = origine;
      if (finAttendue !== null) {
        const n = Math.round((origine - finAttendue) / (police.espace * s));
        if (n > 0) texte += ' '.repeat(Math.min(n, 5));
      }
      texte += trouve.car;
      finAttendue = origine + (trouve.glyphe.advanceWidth || 0) * s;
      i += trouve.contours.length;
    }
    return { texte, debut, fin: finAttendue ?? debut };
  }
}

/** « M1 2L3-4Q…Z » → contours (commandes absolues ; NaN conservé tel quel). */
export function lireContours(d: string): Contour[] {
  const jetons = d.match(/[MLQCZ]|NaN|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  const contours: Contour[] = [];
  let courant: Contour | null = null;
  const ARITE: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
  let k = 0;
  while (k < jetons.length) {
    const type = jetons[k++].toUpperCase();
    if (!(type in ARITE)) continue;
    const pts = jetons.slice(k, k + ARITE[type]).map(Number);
    k += ARITE[type];
    if (type === 'M') {
      courant = [];
      contours.push(courant);
    }
    courant?.push({ type, pts });
  }
  /* Un contour qui ne dessine rien (« M6 0 L6 0 » : point de départ vide que
     certaines polices placent avant la lettre, Russo One « É ») n'en est pas
     un — l'ancien toPathData le réduisait à un M seul. */
  return contours.filter((c) => sansSegmentsNuls(c).length > 1);
}

function cadre(contour: Contour): { w: number; h: number } {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const c of contour) {
    for (let j = 0; j < c.pts.length; j += 2) {
      const [x, y] = [c.pts[j], c.pts[j + 1]];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      x1 = Math.min(x1, x); x2 = Math.max(x2, x);
      y1 = Math.min(y1, y); y2 = Math.max(y2, y);
    }
  }
  return { w: x2 - x1, h: y2 - y1 };
}

/**
 * Les contours du SVG, à partir de `debut`, sont-ils ceux du glyphe à
 * l'échelle `s` ? Comparaison relative au 1er point de CHAQUE contour
 * (indépendante de la position). Les NaN du bug d'arrondi sont ignorés.
 */
function coincide(svg: Contour[], debut: number, glyphe: Contour[], s: number): boolean {
  for (let n = 0; n < glyphe.length; n++) {
    /* Les deux côtés ramenés en pixels du SVG, relatifs au 1er point, puis
       simplifiés de la même manière que l'ancien `toPathData` (seuil en px). */
    const a = normaliser(svg[debut + n], 1);
    const b = normaliser(glyphe[n], s);
    if (!a || !b || a.length !== b.length) return false;
    for (let k = 0; k < a.length; k++) {
      if (a[k].type !== b[k].type) return false;
      const pa = a[k].pts, pb = b[k].pts;
      for (let j = 0; j < pa.length; j++) {
        const ecart = pa[j] - pb[j];
        if (Number.isNaN(ecart)) continue; // NaN du bug d'arrondi : joker
        /* Arrondi à 2 décimales + imprécision de l'échelle (≈ 0,2 % au pire). */
        if (Math.abs(ecart) > 0.03 + 0.003 * Math.abs(pb[j])) return false;
      }
    }
  }
  return true;
}

/**
 * Comparaison stricte, contour par contour, relative au 1er point : mêmes
 * commandes, mêmes points à l'arrondi près (2 décimales dans le SVG).
 * Les NaN du bug d'arrondi sont des jokers.
 */
function strict(svg: Contour[], debut: number, glyphe: Contour[]): boolean {
  for (let n = 0; n < glyphe.length; n++) {
    if (!aligner(sansSegmentsNuls(svg[debut + n]), sansSegmentsNuls(glyphe[n]), 0.025)) return false;
  }
  return true;
}

/**
 * Apparie les commandes de deux contours (relatifs à leur 1er point valide).
 *
 * Un segment droit de moins de 0,02 px présent d'un seul côté est sauté : à
 * 8 px, deux points distants de 0,008 px deviennent identiques une fois
 * arrondis à 2 décimales dans le SVG, et l'un des côtés perd un segment que
 * l'autre garde. La forme est la même.
 *
 * @param tol écart maximal entre points appariés (px)
 * @returns les paires d'indices [a, b], ou null si les contours diffèrent
 */
function aligner(a: Contour, b: Contour, tol: number): Array<[number, number]> | null {
  const ancrage = ancre(a, b);
  if (!ancrage) return null;
  const [ax, ay, bx, by] = ancrage;
  const minuscule = (c: Contour, k: number): boolean => {
    if (c[k].type !== 'L' || k === 0) return false;
    const [px, py] = c[k - 1].pts.slice(-2);
    return Math.abs(c[k].pts[0] - px) <= 0.021 && Math.abs(c[k].pts[1] - py) <= 0.021;
  };
  const proches = (ka: number, kb: number): boolean => {
    if (a[ka].type !== b[kb].type) return false;
    const pa = a[ka].pts, pb = b[kb].pts;
    for (let j = 0; j < pa.length; j++) {
      const ecart = j % 2 === 0 ? pa[j] - ax - (pb[j] - bx) : pa[j] - ay - (pb[j] - by);
      if (Number.isNaN(ecart)) continue; // NaN du bug d'arrondi : joker
      if (Math.abs(ecart) > tol) return false;
    }
    return true;
  };
  const paires: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (proches(i, j)) paires.push([i++, j++]);
    else if (minuscule(a, i)) i++;
    else if (minuscule(b, j)) j++;
    else return null;
  }
  for (; i < a.length; i++) if (!minuscule(a, i)) return null;
  for (; j < b.length; j++) if (!minuscule(b, j)) return null;
  return paires;
}

/** 1er point valide (hors NaN) des deux contours alignés : [ax, ay, bx, by]. */
function ancre(a: Contour, b: Contour): [number, number, number, number] | null {
  for (let k = 0; k < Math.min(a.length, b.length); k++) {
    const pa = a[k].pts, pb = b[k].pts;
    for (let j = 0; j + 1 < pa.length; j += 2) {
      if ([pa[j], pa[j + 1], pb[j], pb[j + 1]].every(Number.isFinite)) return [pa[j], pa[j + 1], pb[j], pb[j + 1]];
    }
  }
  return null;
}

/**
 * Sans `Z` ni segments droits de longueur nulle. L'ancien `toPathData`
 * retirait ces doublons par égalité STRICTE de flottants : selon la position
 * de la lettre dans le mot, un doublon survivait ou non (le « i » de
 * « Marti » en Dancing Script 28 px). Ils ne changent pas la forme.
 */
function sansSegmentsNuls(contour: Contour): Contour {
  const out: Contour = [];
  for (const c of contour) {
    if (c.type === 'Z') continue;
    const prec = out[out.length - 1];
    if (c.type === 'L' && prec) {
      const [px, py] = prec.pts.slice(-2);
      /* Un doublon réel est identique à l'arrondi près (0,005) ; un seuil plus
         large avalerait de vrais petits segments aux petites tailles. */
      if (Math.abs(c.pts[0] - px) < 0.006 && Math.abs(c.pts[1] - py) < 0.006) continue;
    }
    out.push(c);
  }
  /* Segment de fermeture court : l'ancien toPathData le supprimait s'il
     revenait à 1 px ou moins du départ. À 8 px, bien des segments font
     EXACTEMENT 1 px (125 unités × 8/1000) et le calcul flottant fait basculer
     la décision d'un côté ou de l'autre. Le contour se refermant de toute
     façon, ce segment ne change pas la forme : on le retire des deux côtés. */
  const der = out[out.length - 1];
  if (out.length > 2 && der.type === 'L') {
    const [x0, y0] = out[0].pts;
    if (Math.abs(der.pts[0] - x0) <= 1.05 && Math.abs(der.pts[1] - y0) <= 1.05) out.pop();
  }
  return out;
}

/**
 * Filtre rapide avant la comparaison exacte : même nombre de contours, et
 * pas plus de commandes que le glyphe brut — les simplifications en
 * retirent (doublons nombreux : 23 sur le « M » de Dancing Script), jamais
 * n'en ajoutent.
 */
function structureProche(svg: Contour[], debut: number, c: Candidat): boolean {
  if (debut + c.contours.length > svg.length) return false;
  for (let n = 0; n < c.contours.length; n++) {
    const a = svg[debut + n].length, b = c.contours[n].length;
    if (a > b + 1 || a < b / 2 - 1) return false;
  }
  return true;
}

/** Correction d'échelle (≈ 1) entre le contour du SVG et le contour exact, ou null. */
function facteurEchelle(svg: Contour, exact: Contour): number | null {
  const a = sansSegmentsNuls(svg);
  const b = sansSegmentsNuls(exact);
  /* Tolérance large : l'échelle n'est encore qu'approchée (quelques %). */
  const c = cadre(b);
  const paires = aligner(a, b, 0.08 * Math.max(c.w, c.h) + 0.05);
  const ancrage = paires && ancre(a, b);
  if (!paires || !ancrage) return null;
  const [ax, ay, bx, by] = ancrage;
  let num = 0, den = 0;
  for (const [ka, kb] of paires) {
    for (let j = 0; j < a[ka].pts.length; j++) {
      const va = a[ka].pts[j] - (j % 2 ? ay : ax);
      const vb = b[kb].pts[j] - (j % 2 ? by : bx);
      if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
      num += va * vb;
      den += vb * vb;
    }
  }
  return den > 0 ? num / den : null;
}

/** Échelle qui superpose au mieux le contour du glyphe à celui du SVG, ou null. */
function echelleOptimale(svg: Contour, glyphe: Contour, approx: number): number | null {
  const a = normaliser(svg, 1);
  const b = normaliser(glyphe, approx);
  if (!a || !b || a.length !== b.length) return null;
  let num = 0, den = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k].type !== b[k].type) return null;
    for (let j = 0; j < a[k].pts.length; j++) {
      const va = a[k].pts[j], vb = b[k].pts[j] / approx;
      if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
      num += va * vb;
      den += vb * vb;
    }
  }
  return den > 0 ? num / den : null;
}

/**
 * Contour relatif à son 1er point, à l'échelle `s`, sans `Z`, sans segments
 * de longueur nulle, et sans le dernier segment droit s'il revient à moins
 * d'1 px du départ — les simplifications de l'ancien `toPathData`, qui
 * dépendent de la taille en pixels.
 */
function normaliser(contour: Contour, s: number): Contour | null {
  const [x0, y0] = contour[0].pts;
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null;
  const rel = contour
    .filter((c) => c.type !== 'Z')
    .map((c) => ({
      type: c.type,
      pts: c.pts.map((v, j) => (j % 2 === 0 ? (v - x0) * s : (v - y0) * s)),
    }));

  const out: Contour = [];
  for (const c of rel) {
    const prec = out[out.length - 1];
    if (c.type === 'L' && prec) {
      const [px, py] = prec.pts.slice(-2);
      if (Math.abs(c.pts[0] - px) < 0.015 && Math.abs(c.pts[1] - py) < 0.015) continue;
    }
    out.push(c);
  }
  while (out.length > 1) {
    const der = out[out.length - 1];
    if (der.type !== 'L' || Math.abs(der.pts[0]) > 1 || Math.abs(der.pts[1]) > 1) break;
    out.pop();
  }
  return out;
}
