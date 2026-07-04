import {
  BadRequestException,
  Controller,
  Delete,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import {
  CloudinaryService,
  UploadResult,
} from '../shared/cloudinary.service';

// Type minimal du fichier multer (evite la dependance forte a @types/multer dans la signature).
interface UploadedMulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly cloudinary: CloudinaryService,
    private readonly config: ConfigService,
  ) {}

  private get maxFileSize(): number {
    return parseInt(
      this.config.get<string>('MAX_FILE_SIZE') || '10485760',
      10,
    );
  }

  /**
   * POST /api/uploads/logo
   * Optimise (2000x2000, PNG q90) et upload sur Cloudinary.
   */
  @Post('logo')
  @UseInterceptors(FileInterceptor('file'))
  async uploadLogo(
    @UploadedFile() file: UploadedMulterFile,
  ): Promise<UploadResult> {
    this.assertFile(file);
    try {
      return await this.cloudinary.uploadLogo(file.buffer);
    } catch (error) {
      throw new HttpException(
        `Echec upload logo: ${(error as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * POST /api/uploads/preview
   * Optimise (1200x1200, JPEG q85) et upload dans le dossier previews.
   */
  @Post('preview')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPreview(
    @UploadedFile() file: UploadedMulterFile,
  ): Promise<UploadResult> {
    this.assertFile(file);
    try {
      return await this.cloudinary.uploadPreview(file.buffer);
    } catch (error) {
      throw new HttpException(
        `Echec upload preview: ${(error as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * DELETE /api/uploads/:publicId
   * Supprime une image de Cloudinary.
   * Le publicId peut contenir des '/', on utilise donc un wildcard.
   */
  @Delete(':publicId(*)')
  async remove(
    @Param('publicId') publicId: string,
  ): Promise<{ success: boolean }> {
    try {
      const ok = await this.cloudinary.deleteImage(publicId);
      return { success: ok };
    } catch (error) {
      throw new HttpException(
        `Echec suppression: ${(error as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /** Validation basique du fichier recu (presence + taille). */
  private assertFile(file: UploadedMulterFile): void {
    if (!file || !file.buffer) {
      throw new BadRequestException('Aucun fichier fourni (champ "file").');
    }
    if (file.size > this.maxFileSize) {
      throw new BadRequestException(
        `Fichier trop volumineux (max ${this.maxFileSize} octets).`,
      );
    }
  }
}
