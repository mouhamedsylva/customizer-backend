import {
  BadRequestException,
  Controller,
  Delete,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import {
  CloudinaryService,
  UploadResult,
} from '../shared/cloudinary.service';
import { AdminSessionGuard } from '../admin/admin-session.guard';

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
   * POST /api/uploads/piece-jointe
   * Pièce jointe d'une demande de devis : images ET PDF, envoyés tels quels.
   *
   * Route distincte de /logo parce que ce dernier passe par sharp, qui échoue
   * sur un PDF. Publique comme les deux autres : le visiteur qui demande un
   * devis n'est pas authentifié.
   */
  @Post('piece-jointe')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPieceJointe(
    @UploadedFile() file: UploadedMulterFile,
  ): Promise<UploadResult> {
    this.assertFile(file);

    /* Contrôle de type MIME — les routes /logo et /preview n'en font AUCUN, la
       validation y est purement cliente. Ici on l'ajoute côté serveur : cette
       route accepte le PDF, donc la liste des types autorisés doit être fermée
       explicitement plutôt que laissée ouverte à n'importe quel binaire. */
    const TYPES_AUTORISES = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
      'application/pdf',
    ];
    const type = String(file.mimetype || '').toLowerCase();
    if (!TYPES_AUTORISES.includes(type)) {
      throw new HttpException(
        `Type de fichier non accepté (${type || 'inconnu'}). ` +
          'Formats acceptés : JPG, PNG, WEBP, GIF, SVG, PDF.',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      return await this.cloudinary.uploadPieceJointe(
        file.buffer,
        file.originalname,
      );
    } catch (error) {
      throw new HttpException(
        `Echec upload piece jointe: ${(error as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * DELETE /api/uploads/:publicId — RÉSERVÉ AUX ADMINS.
   *
   * Supprime définitivement une image de Cloudinary. Cette route était
   * publique : le publicId n'est pas un secret (il est renvoyé par les
   * endpoints d'upload et figure dans les URLs affichées sur le thème), donc
   * n'importe qui pouvait détruire les logos et aperçus de commandes en
   * production.
   *
   * Le publicId peut contenir des '/', on utilise donc un wildcard.
   */
  @UseGuards(AdminSessionGuard)
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
