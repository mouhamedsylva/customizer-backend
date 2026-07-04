import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Param,
  Post,
} from '@nestjs/common';
import { ExportService } from './export.service';
import { ShareDesignDto } from './dto/share-design.dto';

@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  /** POST /api/export/share */
  @Post('share')
  createShare(
    @Body() dto: ShareDesignDto,
  ): { shareId: string; shareUrl: string } {
    return this.exportService.createShare(dto.designData);
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
