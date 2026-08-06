import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Borne le dictionnaire `properties` : nombre de clés, et longueur de chaque
 * clé et de chaque valeur.
 *
 * La valeur est large (2 M caractères) car une propriété peut porter un aperçu
 * en data-URL, comme pour les devis. Ce qui compte est qu'une borne EXISTE :
 * sans elle, seul le plafond de corps de requête (25 Mo) s'appliquait.
 */
@ValidatorConstraint({ name: 'cartProperties', async: false })
export class CartPropertiesConstraint implements ValidatorConstraintInterface {
  private static readonly MAX_KEYS = 40;
  private static readonly MAX_KEY_LEN = 100;
  private static readonly MAX_VALUE_LEN = 2_000_000;

  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) return false;

    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > CartPropertiesConstraint.MAX_KEYS) return false;

    return entries.every(
      ([k, v]) =>
        k.length <= CartPropertiesConstraint.MAX_KEY_LEN &&
        typeof v === 'string' &&
        v.length <= CartPropertiesConstraint.MAX_VALUE_LEN,
    );
  }

  defaultMessage(): string {
    return (
      `properties : ${CartPropertiesConstraint.MAX_KEYS} entrées maximum, ` +
      `clés de ${CartPropertiesConstraint.MAX_KEY_LEN} caractères et valeurs ` +
      `textuelles de ${CartPropertiesConstraint.MAX_VALUE_LEN} caractères au plus.`
    );
  }
}

/**
 * Body de POST /api/cart/add.
 * `properties` : proprietes de personnalisation libres (cle/valeur).
 */
export class AddToCartDto {
  @IsNotEmpty()
  variantId!: string | number;

  // Plafond : une ligne de panier au-delà de 10 000 pièces relève du devis, pas
  // du panier. Sans borne, un entier arbitraire partait tel quel chez Shopify.
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity!: number;

  /**
   * Propriétés de personnalisation (couleur, taille, URLs d'aperçu…).
   *
   * Bornées : ces valeurs partent chez Shopify, sont recopiées en base par le
   * webhook et réaffichées au dashboard. Sans limite, une seule requête pouvait
   * y placer plusieurs mégaoctets — le seul DTO que la passe de durcissement
   * avait laissé sans plafond.
   *
   * La validation est faite à la main : `class-validator` ne sait pas contrôler
   * les valeurs d'un `Record` dont les clés sont libres.
   */
  @IsOptional()
  @IsObject()
  @Validate(CartPropertiesConstraint)
  properties?: Record<string, string>;

  // Si fourni, on ajoute la ligne a ce panier existant, sinon on en cree un nouveau.
  @IsOptional()
  @IsString()
  draftOrderId?: string;

  /**
   * Jeton de possession, remis à la création du panier.
   *
   * OBLIGATOIRE dès que `draftOrderId` est fourni : l'id Shopify est un entier
   * séquentiel, donc devinable. Sans ce jeton, n'importe qui pouvait injecter
   * des articles dans le panier d'un autre client.
   */
  @IsOptional()
  @IsString()
  cartToken?: string;
}
