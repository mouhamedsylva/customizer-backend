import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
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

/** Informations client d'une commande. */
export class OrderCustomerDto {
  @IsString()
  @IsNotEmpty()
  prenom!: string;

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

/** Une ligne d'article de la commande. */
export class OrderItemDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsNumber()
  @Min(1)
  qty!: number;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsString()
  img?: string;

  @IsOptional()
  @IsObject()
  properties?: Record<string, string>;
}

/** Body de POST /api/orders. */
export class CreateOrderDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => OrderCustomerDto)
  customer!: OrderCustomerDto;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @IsNumber()
  @Min(0)
  total!: number;
}
