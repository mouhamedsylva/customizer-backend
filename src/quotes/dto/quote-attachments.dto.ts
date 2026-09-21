import { IsArray, IsOptional, IsString, MaxLength, ArrayMaxSize } from 'class-validator';

/**
 * DTO pour les pièces jointes d'un devis/facture.
 * Utilisé lors du chiffrage et envoi de facture.
 */
export class QuoteAttachmentDto {
  /** Nom d'origine du fichier */
  @IsString()
  @MaxLength(200)
  name: string;

  /** URL Cloudinary du fichier uploadé */
  @IsString()
  @MaxLength(500)
  url: string;

  /** Type MIME du fichier */
  @IsString()
  @MaxLength(100)
  type: string;

  /** Taille du fichier en octets */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  size?: string;
}

/**
 * Extension du DTO d'envoi de facture pour inclure les pièces jointes.
 */
export class SendInvoiceWithAttachmentsDto {
  @IsString()
  unitPrice: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  /** Pièces jointes à inclure dans l'email de facture */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5) // Maximum 5 fichiers
  attachments?: QuoteAttachmentDto[];
}