import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Un logo à superposer, positions/taille en fractions (0..1) du fond.
 *
 * LES BORNES SONT INDISPENSABLES, pas décoratives. `w` est multiplié par la
 * largeur du canvas (`cloudinary.service.ts` : `logo.w * canvasW`) : une valeur
 * hors de [0,1] demande à sharp une image démesurée.
 *
 * Mesuré sur l'endpoint PUBLIC `/api/export/preview-image`, avant correctif :
 *
 *     w = 0.2  ->  201 en  2 222 ms   (valeur normale)
 *     w = 20   ->  201 en 34 877 ms   <-- 35 s de calcul, réponse acceptée
 *     w = 200  ->  502 en  2 082 ms   (sharp refuse enfin la dimension)
 *
 * La zone dangereuse est l'intermédiaire : le calcul aboutit, mais mobilise le
 * serveur une demi-minute. Avec un throttle de 10 req/min, dix requêtes de ce
 * type l'occupent plus de cinq minutes. Un client n'a aucune raison d'envoyer
 * ces valeurs — le thème envoie toujours des fractions — donc les refuser tôt
 * ne casse aucun usage légitime.
 *
 * `x` et `y` sont bornés à [0,1] pour la même raison de cohérence, même si
 * `composeViewBuffer` les recadre déjà (`Math.min(Math.max(0, left), …)`) : une
 * position hors cadre est une erreur d'appel, pas une intention.
 */
export class PreviewLogoDto {
  @IsString()
  @IsNotEmpty()
  src!: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  y!: number;

  /* Borne basse à 0 exclu de fait : un logo de largeur nulle est invisible, mais
     inoffensif — on ne l'interdit pas pour ne pas casser un appel qui masque
     temporairement un calque. */
  @IsNumber()
  @Min(0)
  @Max(1)
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
