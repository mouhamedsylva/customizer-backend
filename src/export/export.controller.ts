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
import { ExportService } from './export.service';
import { ShareDesignDto } from './dto/share-design.dto';
import { PreviewImageDto } from './dto/preview-image.dto';
import { CloudinaryService } from '../shared/cloudinary.service';

@Controller('export')
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /** POST /api/export/share */
  @Post('share')
  createShare(
    @Body() dto: ShareDesignDto,
  ): { shareId: string; shareUrl: string } {
    return this.exportService.createShare(dto.designData);
  }

  /**
   * POST /api/export/preview-image
   * Compose le design (fond produit + logos) en une image et l'upload
   * sur Cloudinary. Retourne l'URL publique, partageable (WhatsApp, mail...).
   */
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

  /** GET /api/export/share/:shareId */
  @Get('share/:shareId')
  getShare(@Param('shareId') shareId: string): Record<string, unknown> {
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
