import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotImplementedException,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ExportService } from './export.service';
import { ShareDesignDto } from './dto/share-design.dto';
import { PreviewImageDto } from './dto/preview-image.dto';
import { PreviewMultiDto } from './dto/preview-multi.dto';
import { CloudinaryService } from '../shared/cloudinary.service';

/** Taille maximale d'un design partagé, sérialisé (caractères). */
const TAILLE_MAX_DESIGN = 1_000_000;

@Controller('export')
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /**
   * POST /api/export/share
   *
   * Route PUBLIQUE qui écrit en base : plafonnée en débit et en taille. Sans
   * limite propre, le `designData` (JSON libre) pouvait peser jusqu'à la borne
   * globale du corps (25 Mo) ; quelques centaines d'envois remplissaient la
   * table. Un design sérialisé pèse quelques Ko — les images y sont des URL
   * Cloudinary, pas des données brutes.
   */
  @Post('share')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async createShare(
    @Body() dto: ShareDesignDto,
  ): Promise<{ shareId: string; shareUrl: string }> {
    if (JSON.stringify(dto.designData ?? {}).length > TAILLE_MAX_DESIGN) {
      throw new HttpException(
        'Design trop volumineux pour être partagé.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    return this.exportService.createShare(dto.designData);
  }

  /**
   * POST /api/export/preview-image
   * Compose le design (fond produit + logos) en une image et l'upload
   * sur Cloudinary. Retourne l'URL publique, partageable (WhatsApp, mail...).
   *
   * Plafond dédié : cette route télécharge N images, les décode avec sharp
   * (opération lourde) et crée un asset Cloudinary permanent — donc facturé.
   * 60/min : une commande de groupe compose 1 à 2 vues par couleur et par
   * face ; à 10/min, les fiches de production au-delà étaient perdues sans
   * message (le thème ne journalise que dans la console).
   */
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Post('preview-image')
  async previewImage(@Body() dto: PreviewImageDto): Promise<{ url: string }> {
    try {
      const result = await this.cloudinary.composeAndUploadPreview(
        dto.background,
        dto.logos || [],
      );
      return { url: result.url };
    } catch (error) {
      throw new HttpException(
        `Echec generation image: ${(error as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * POST /api/export/preview-multi
   * Compose plusieurs vues (face/dos/côté) en une planche unique et l'upload
   * sur Cloudinary. Retourne l'URL publique.
   *
   * La route la plus coûteuse du backend : jusqu'à 8 vues × 21 téléchargements.
   * Plafond en complément des `@ArrayMaxSize` du DTO. 60/min et non 10 : une
   * commande de groupe en appelle UNE PAR NOM ; à 10/min, la fiche « Aperçu »
   * de production manquait au-delà de 10 personnes.
   */
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Post('preview-multi')
  async previewMulti(@Body() dto: PreviewMultiDto): Promise<{ url: string }> {
    try {
      const result = await this.cloudinary.composeMultiViewAndUpload(dto.views);
      return { url: result.url };
    } catch (error) {
      throw new HttpException(
        `Echec generation planche: ${(error as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /** GET /api/export/share/:shareId */
  @Get('share/:shareId')
  async getShare(
    @Param('shareId') shareId: string,
  ): Promise<Record<string, unknown>> {
    return this.exportService.getShare(shareId);
  }

  /**
   * POST /api/export/pdf
   * Stub : generation PDF non implementee cote backend pour l'instant.
   */
  @Post('pdf')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  exportPdf(): never {
    throw new NotImplementedException(
      'Export PDF non implemente. Utilisez /api/export/share ou generez le PDF cote client.',
    );
  }
}
