import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  Min,
} from 'class-validator';

/**
 * Body de POST /api/cart/add.
 * `properties` : proprietes de personnalisation libres (cle/valeur).
 */
export class AddToCartDto {
  @IsNotEmpty()
  variantId!: string | number;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsObject()
  properties?: Record<string, string>;

  // Si fourni, on ajoute la ligne a ce panier existant, sinon on en cree un nouveau.
  @IsOptional()
  draftOrderId?: string | number;
}
