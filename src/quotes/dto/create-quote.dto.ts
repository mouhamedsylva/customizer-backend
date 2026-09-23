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

  /**
   * URL Cloudinary du fichier joint par le client (logo, visuel de référence…).
   *
   * DOIT figurer ici : le ValidationPipe tourne avec `whitelist: true`
   * (main.ts), donc un champ absent du DTO serait silencieusement supprimé —
   * la demande arriverait sans son fichier, sans la moindre erreur.
   *
   * C'est une URL, pas le fichier : le client l'uploade d'abord via
   * `POST /api/uploads/piece-jointe`, puis n'envoie que l'adresse obtenue.
   * 500 caractères suffisent largement à une URL Cloudinary.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  fichierUrl?: string;

  /** Nom d'origine du fichier, pour l'afficher tel que le client l'a envoyé. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fichierNom?: string;
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

/**
 * Une FAMILLE de produits d'un devis multi-produits (patchs, coins, textiles…).
 *
 * Un panier mêlant plusieurs types devenait une seule ligne de 164 unités, à
 * prix unique : impossible de chiffrer un patch à 2 € et un sweatshirt à 40 €.
 * Chaque famille devient donc sa propre ligne de brouillon, avec son prix.
 *
 * ⚠️ Ce DTO est INDISPENSABLE. La validation tourne en `whitelist: true` : un
 * champ non déclaré est supprimé SANS ERREUR. Sans cette classe, les familles
 * disparaîtraient en silence et le devis repartirait en ligne unique, sans que
 * rien ne le signale.
 */
export class QuoteFamilyDto {
  /** Clé technique : 'patch', 'coin', 'sweatshirt', 'tshirt', 'drapeau'… */
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  cle!: string;

  /** Intitulé client, repris tel quel sur la facture. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  libelle!: string;

  @IsNumber()
  @Min(1)
  @Max(100000)
  qty!: number;

  /* Le détail des articles de cette famille, attaché à sa ligne : l'atelier le
     retrouve en propriété, au lieu d'un bloc global détaché des prix. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  lignes?: string[];
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

  /* Facultatif : seuls les devis issus d'un panier MULTI-PRODUITS en portent.
     Un devis de patch ou de coin seul n'a qu'un type d'article et reste sur une
     ligne unique — d'où l'absence de ce champ, et non un oubli. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => QuoteFamilyDto)
  familles?: QuoteFamilyDto[];
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
