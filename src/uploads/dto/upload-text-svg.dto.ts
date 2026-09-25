import { Type } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  ValidateNested,
  IsArray,
  ArrayMaxSize,
  Min,
  Max,
  MaxLength,
  IsIn,
} from 'class-validator';

/**
 * Segment de texte avec sa mise en forme individuelle.
 */
export class TextSegmentDto {
  /** Contenu textuel du segment. */
  @IsString()
  @MaxLength(100) // Limite raisonnable par segment
  text!: string;

  /** Famille de police (ex: "Arial", "sans-serif"). */
  @IsString()
  @MaxLength(50)
  fontFamily!: string;

  /**
   * Taille de police en pixels.
   *
   * PLANCHER À 1, ET NON À 8.
   *
   * Le configurateur réduit un texte jusqu'à 4 px pour le faire tenir dans sa
   * zone (conf-text-clamp.js) — un nom long sur une manche, par exemple. Avec
   * un `@Min(8)`, ces textes parfaitement légitimes étaient rejetés en 400 :
   * le thème retombait alors sur son rendu local, dont le téléversement
   * échouait à son tour et était avalé en silence. Résultat : le texte
   * s'affichait sur la planche d'aperçu mais n'arrivait JAMAIS à l'atelier en
   * fichier séparé.
   *
   * La validation n'a pas à trancher cette question : `normalizeFontParams`
   * (text-svg.service.ts) remonte déjà toute valeur sous 8 px à 8 —
   * `Math.max(8, Math.min(300, ...))` — et le contrôleur l'applique à chaque
   * segment AVANT le rendu (uploads.controller.ts:149). Le refus arrivait donc
   * avant le seul code capable de traiter le cas.
   *
   * On garde un plancher strictement positif : une taille nulle ou négative
   * reste une donnée aberrante, pas un texte à rendre petit.
   */
  @IsNumber()
  @Min(1)
  @Max(300)
  fontSize!: number;

  /** Épaisseur de police ("400", "700", "bold", "normal"). */
  @IsString()
  @MaxLength(10)
  fontWeight!: string;

  /** Style de police optionnel ("italic", "normal"). */
  @IsOptional()
  @IsString()
  @IsIn(['italic', 'normal', ''])
  fontStyle?: string;

  /** Couleur du texte (hex, rgb, rgba, ou nom de couleur). */
  @IsString()
  @MaxLength(30)
  color!: string;

  /** Texte souligné. */
  @IsOptional()
  @IsBoolean()
  underline?: boolean;
}

/**
 * Options de rendu SVG.
 */
export class RenderOptionsDto {
  /** Facteur d'échelle de résolution (1 = normal, 2 = 2x, 4 = 4x). */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(8)
  scale?: number;

  /** Padding autour du texte en pixels. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  padding?: number;

  /** Couleur de fond optionnelle (transparent par défaut). */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  backgroundColor?: string;
}

/**
 * Body de POST /api/uploads/text-svg.
 * 
 * Génère un asset texte haute résolution via SVG côté serveur,
 * remplaçant la rasterisation canvas côté client.
 */
export class UploadTextSvgDto {
  /** Segments de texte avec mise en forme individuelle. */
  @IsArray()
  @ArrayMaxSize(20) // Limite le nombre de segments
  @ValidateNested({ each: true })
  @Type(() => TextSegmentDto)
  segments!: TextSegmentDto[];

  /** Type de produit pour organisation des dossiers Cloudinary. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @IsIn(['tshirt', 'sweatshirt', 'patch', 'coin', 'flag', 'generic'])
  productType?: string;

  /** Emplacement sur le produit (face, dos, manche, etc.). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @IsIn(['front', 'back', 'sleeve-left', 'sleeve-right', 'chest-left', 'chest-right', 'generic'])
  placement?: string;

  /** Options de rendu SVG. */
  @IsOptional()
  @ValidateNested()
  @Type(() => RenderOptionsDto)
  renderOptions?: RenderOptionsDto;

  /** Métadonnées additionnelles pour traçabilité. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  metadata?: string;
}

/**
 * Réponse de l'upload texte SVG.
 * Étend UploadResult du CloudinaryService.
 */
export interface UploadTextSvgResponse {
  /** URL publique Cloudinary de l'asset généré. */
  url: string;
  
  /** ID public Cloudinary pour suppression. */
  publicId: string;
  
  /** Dimensions de l'image générée. */
  width: number;
  height: number;
  
  /** Format de l'asset (toujours 'png' pour texte). */
  format: string;
  
  /** Taille du fichier en octets. */
  bytes: number;
  
  /** Métadonnées de génération. */
  generation: {
    method: 'svg-server';
    segmentCount: number;
    scale: number;
    generatedAt: string;
  };
}