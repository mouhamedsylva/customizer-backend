import { Type } from 'class-transformer';
import {
  IsString,
  IsArray,
  IsOptional,
  ValidateNested,
  ArrayMaxSize,
  MaxLength,
  IsUrl,
  IsObject,
} from 'class-validator';
import { TextSegmentDto, RenderOptionsDto } from '../../uploads/dto/upload-text-svg.dto';

/**
 * Logo ou élément graphique dans l'aperçu.
 */
export class PreviewLogoDto {
  /** URL source de l'image (Cloudinary, Shopify CDN, data-URL). */
  @IsString()
  @MaxLength(2000) // Data-URLs peuvent être longues
  src!: string;

  /** Position X relative (0.0 à 1.0). */
  @IsOptional()
  x?: number;

  /** Position Y relative (0.0 à 1.0). */
  @IsOptional()
  y?: number;

  /** Largeur relative (0.0 à 1.0). */
  @IsOptional()
  w?: number;

  /** Hauteur relative optionnelle (0.0 à 1.0). */
  @IsOptional()
  h?: number;

  /** Rotation en degrés. */
  @IsOptional()
  rotation?: number;

  /** Opacité (0.0 à 1.0). */
  @IsOptional()
  opacity?: number;
}

/**
 * Zone de texte avec métadonnées pour génération SVG haute résolution.
 */
export class PreviewTextZoneDto {
  /** Identifiant de la zone (face, dos, manche-gauche, etc.). */
  @IsString()
  @MaxLength(50)
  zoneId!: string;

  /** Segments de texte avec styles individuels. */
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TextSegmentDto)
  segments!: TextSegmentDto[];

  /** Position X relative dans l'aperçu (0.0 à 1.0). */
  x!: number;

  /** Position Y relative dans l'aperçu (0.0 à 1.0). */
  y!: number;

  /** Largeur relative dans l'aperçu (0.0 à 1.0). */
  w!: number;

  /** Options de rendu SVG spécifiques à cette zone. */
  @IsOptional()
  @ValidateNested()
  @Type(() => RenderOptionsDto)
  renderOptions?: RenderOptionsDto;

  /** Rotation du texte en degrés. */
  @IsOptional()
  rotation?: number;

  /** Opacité du texte (0.0 à 1.0). */
  @IsOptional()
  opacity?: number;
}

/**
 * Body de POST /api/export/preview-quote-text.
 * 
 * Génère un aperçu de devis haute résolution combinant:
 * - Image de fond du produit
 * - Logos positionnés
 * - Textes générés en SVG haute résolution
 */
export class PreviewQuoteTextDto {
  /** URL de l'image de fond du produit. */
  @IsString()
  @IsUrl(undefined, { message: 'backgroundUrl doit être une URL valide' })
  @MaxLength(500)
  backgroundUrl!: string;

  /** Largeur de rendu souhaitée (défaut: 1500px). */
  @IsOptional()
  renderWidth?: number;

  /** Logos et éléments graphiques à superposer. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50) // Limite le nombre d'éléments
  @ValidateNested({ each: true })
  @Type(() => PreviewLogoDto)
  logos?: PreviewLogoDto[];

  /** Zones de texte avec génération SVG haute résolution. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10) // Limite le nombre de zones texte
  @ValidateNested({ each: true })
  @Type(() => PreviewTextZoneDto)
  textZones?: PreviewTextZoneDto[];

  /** Type de produit pour optimisations spécifiques. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  productType?: string;

  /** Vue du produit (face, dos, côté, etc.). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  productView?: string;

  /** Métadonnées du devis pour traçabilité. */
  @IsOptional()
  @IsObject()
  quoteMetadata?: Record<string, unknown>;

  /** Options globales de composition. */
  @IsOptional()
  @IsObject()
  compositionOptions?: {
    /** Format de sortie ('png' | 'jpg'). */
    format?: 'png' | 'jpg';
    
    /** Qualité JPEG (10-100, ignoré pour PNG). */
    quality?: number;
    
    /** Couleur de fond si format opaque. */
    backgroundColor?: string;
    
    /** Ajout d'un watermark. */
    watermark?: boolean;
  };
}

/**
 * Réponse de la génération d'aperçu devis haute résolution.
 */
export interface PreviewQuoteTextResponse {
  /** URL publique de l'aperçu généré. */
  url: string;
  
  /** Dimensions de l'image générée. */
  width: number;
  height: number;
  
  /** Format de l'image générée. */
  format: string;
  
  /** Taille du fichier en octets. */
  bytes: number;
  
  /** Métadonnées de génération. */
  generation: {
    /** Méthode de génération. */
    method: 'svg-enhanced-preview';
    
    /** Nombre de logos composés. */
    logoCount: number;
    
    /** Nombre de zones texte SVG générées. */
    textZoneCount: number;
    
    /** Résolution de rendu utilisée. */
    renderWidth: number;
    
    /** Timestamp de génération. */
    generatedAt: string;
    
    /** Temps de traitement en millisecondes. */
    processingTimeMs: number;
  };
}
