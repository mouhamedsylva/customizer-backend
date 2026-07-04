import { IsNotEmpty, IsObject } from 'class-validator';

/** Body de POST /api/export/share. */
export class ShareDesignDto {
  @IsObject()
  @IsNotEmpty()
  designData!: Record<string, unknown>;
}
