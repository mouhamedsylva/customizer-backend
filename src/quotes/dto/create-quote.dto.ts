import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/** Client demandeur du devis. */
export class QuoteCustomerDto {
  @IsString()
  @IsNotEmpty()
  nom!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  telephone!: string;

  @IsOptional()
  @IsString()
  entreprise?: string;

  @IsOptional()
  @IsString()
  message?: string;
}

/** Apercu d'un coin (base + logo optionnel). */
export class QuotePreviewDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsString()
  @IsNotEmpty()
  base!: string;

  @IsOptional()
  @IsString()
  logo?: string;
}

/** Detail du coin/patch pour lequel le devis est demande. */
export class QuoteCoinDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsArray()
  @IsString({ each: true })
  details!: string[];

  @IsNumber()
  @Min(1)
  qty!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotePreviewDto)
  previews!: QuotePreviewDto[];
}

/** Une ligne d'une commande de groupe (une personne). */
export class GroupRowDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  @IsNotEmpty()
  size!: string;

  @IsString()
  @IsNotEmpty()
  color!: string;

  @IsOptional()
  @IsString()
  flock?: string;

  @IsNumber()
  @Min(1)
  qty!: number;
}

/** Commande de groupe (textiles) : design commun + liste de personnes. */
export class GroupOrderDto {
  @IsString()
  @IsNotEmpty()
  productType!: string;

  @IsOptional()
  @IsString()
  productLabel?: string;

  @IsNumber()
  @Min(1)
  pieces!: number;

  @IsOptional()
  hasFlock?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupRowDto)
  rows!: GroupRowDto[];
}

/** Body de POST /api/quotes. */
export class CreateQuoteDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => QuoteCustomerDto)
  customer!: QuoteCustomerDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => QuoteCoinDto)
  coin!: QuoteCoinDto;

  /** Présent uniquement pour une commande de groupe (textiles). */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => GroupOrderDto)
  group?: GroupOrderDto;
}
