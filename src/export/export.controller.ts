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

@Controller('export')
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /** POST /api/export/share */
  @Post('share')
  async createShare(
    @Body() dto: ShareDesignDto,
  ): Promise<{ shareId: string; shareUrl: string }> {
    return this.exportService.createShare(dto.designData);
  }

  /**
   * POST /api/export/preview-image
   * Compose le design (fond produit + logos) en une image et l'upload
   * sur Cloudinary. Retourne l'URL publique, partageable (WhatsApp, mail...).
   *
   * Plafond dédié : cette route télécharge N images, les décode avec sharp
   * (opération lourde) et crée un asset Cloudinary permanent — donc facturé.
   * Le plafond global de 120/min était très au-dessus de tout usage légitime.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
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
   * Plafond strict, en complément des `@ArrayMaxSize` du DTO.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
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
