import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/** Un logo à superposer, positions/taille en fractions (0..1) du fond. */
export class PreviewLogoDto {
  @IsString()
  @IsNotEmpty()
  src!: string;

  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsNumber()
  w!: number;
}

/** Body de POST /api/export/preview-image. */
export class PreviewImageDto {
  // Image de fond (produit) : URL http(s) ou data-URL.
  @IsString()
  @IsNotEmpty()
  background!: string;

  // Plafonné : chaque logo = 1 téléchargement HTTP + 2 passes sharp.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PreviewLogoDto)
  logos?: PreviewLogoDto[];
}
