import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Client demandeur du devis.
 *
 * Ces champs sont saisis par un visiteur anonyme et réaffichés dans le
 * dashboard : ils sont bornés en longueur pour éviter qu'un texte de plusieurs
 * mégaoctets ne soit stocké puis rendu à chaque ouverture de la page.
 */
export class QuoteCustomerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nom!: string;

  @IsEmail()
  @MaxLength(190)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  telephone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  entreprise?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}

/** Apercu d'un coin (base + logo optionnel). */
export class QuotePreviewDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label!: string;

  /* `base` et `logo` peuvent être des data-URL base64 (aperçus générés au
     navigateur). Le base64 gonfle de 4/3 : 6 M caractères ≈ 4,5 Mo d'image
     réelle, ce qui laisse passer un PNG plein format. La borne précédente
     (2 M) rejetait un aperçu 1200×1200 légitime — ~2 000 022 caractères — avec
     un message de validation incompréhensible pour le client.
     La vraie limite reste le corps de requête, plafonné à 25 Mo. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(6_000_000)
  base!: string;

  @IsOptional()
  @IsString()
  @MaxLength(6_000_000)
  logo?: string;
}

/** Detail du coin/patch pour lequel le devis est demande. */
export class QuoteCoinDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  details!: string[];

  // Plafond : au-delà, la demande relève d'un échange commercial direct, pas
  // d'un formulaire. Sans borne, la quantité partait telle quelle chez Shopify.
  @IsNumber()
  @Min(1)
  @Max(100000)
  qty!: number;

  // Chaque aperçu porte deux URLs rendues dans le dashboard et l'e-mail.
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuotePreviewDto)
  previews!: QuotePreviewDto[];
}

/** Une ligne d'une commande de groupe (une personne). */
export class GroupRowDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  size!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  color!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  flock?: string;

  @IsNumber()
  @Min(1)
  @Max(10000)
  qty!: number;
}

/** Commande de groupe (textiles) : design commun + liste de personnes. */
export class GroupOrderDto {
  /* Facultatif : le backend n'utilise que `productLabel`. L'exiger rejetait en
     400 un client qui ne l'envoyait pas, sans qu'aucun code ne le lise. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  productType?: string;

  @IsOptional()
  @IsString()
  productLabel?: string;

  @IsNumber()
  @Min(1)
  @Max(100000)
  pieces!: number;

  /* `@IsBoolean()` est indispensable : sans lui, `hasFlock: "false"` était une
     chaîne non vide, donc VRAIE en contexte booléen — la note du brouillon
     Shopify annonçait « avec flocage (à chiffrer) » sur une commande sans
     flocage, et l'équipe chiffrait un supplément inexistant. */
  @IsOptional()
  @IsBoolean()
  hasFlock?: boolean;

  /**
   * Une LIGNE DE BROUILLON SHOPIFY est créée par entrée : sans plafond, une
   * seule demande pouvait générer un brouillon de plusieurs milliers de lignes.
   * 500 personnes couvrent très largement une commande de groupe réelle.
   */
  @IsArray()
  @ArrayMaxSize(500)
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
