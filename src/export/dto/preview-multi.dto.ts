import { Type } from 'class-transformer';
import {
  IsArray,
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
  @ValidateNested({ each: true })
  @Type(() => PreviewLogoDto)
  logos?: PreviewLogoDto[];
}

/** Body de POST /api/export/preview-multi. */
export class PreviewMultiDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreviewViewDto)
  views!: PreviewViewDto[];
}
