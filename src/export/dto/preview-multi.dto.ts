import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PreviewLogoDto } from './preview-image.dto';

/** Une vue à composer dans la planche multi-vues. */
export class PreviewViewDto {
  @IsOptional()
  @IsString()
  label?: string;

  // Image de fond (produit) de la vue : URL http(s) ou data-URL.
  @IsString()
  @IsNotEmpty()
  background!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PreviewLogoDto)
  logos?: PreviewLogoDto[];

  /**
   * Retourne le FOND horizontalement (manche droite).
   * Il n'existe qu'une image de profil : le côté droit est le côté gauche en
   * miroir. Seul le fond est retourné — les logos arrivent déjà positionnés
   * dans le repère retourné, et ne doivent pas être inversés (le design du
   * client apparaîtrait à l'envers).
   */
  @IsOptional()
  @IsBoolean()
  mirror?: boolean;
}

/**
 * Body de POST /api/export/preview-multi.
 *
 * `views` et `logos` sont PLAFONNÉS. Sans borne, chaque vue déclenchant un
 * téléchargement HTTP par fond et par logo puis plusieurs passes sharp, une
 * seule requête de 25 Mo pouvait demander des dizaines de milliers d'opérations
 * — le rate limiting compte les requêtes entrantes, pas le travail déclenché.
 *
 * 8 vues couvrent largement le besoin réel (face, dos, deux manches, et de la
 * marge) ; au-delà, c'est un abus.
 */
export class PreviewMultiDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => PreviewViewDto)
  views!: PreviewViewDto[];
}
