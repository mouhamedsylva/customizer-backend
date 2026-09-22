import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpException,
  HttpStatus,
  Logger,
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
import { TextSvgService } from '../shared/text-svg.service';
import { TextOutlineService } from '../shared/text-outline.service';
import { AdminSessionGuard } from '../admin/admin-session.guard';
import { UploadTextSvgDto } from './dto/upload-text-svg.dto';

// Type minimal du fichier multer (evite la dependance forte a @types/multer dans la signature).
interface UploadedMulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Controller('uploads')
export class UploadsController {
  private readonly logger = new Logger(UploadsController.name);

  constructor(
    private readonly cloudinary: CloudinaryService,
    private readonly config: ConfigService,
    private readonly textSvg: TextSvgService,
    private readonly textOutline: TextOutlineService,
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
   * POST /api/uploads/text-svg
   * Upload de texte haute résolution via génération SVG côté serveur.
   * Remplace la rasterisation canvas côté client par un rendu vectoriel.
   */
  @Post('text-svg')
  async uploadTextSvg(
    @Body() dto: UploadTextSvgDto,
  ): Promise<UploadResult & { svgUrl?: string }> {
    try {
      // Normalisation et validation des segments
      const normalizedSegments = dto.segments.map(seg =>
        this.textSvg.normalizeFontParams(seg)
      );

      const scale = dto.renderOptions?.scale || 4;
      const padding = dto.renderOptions?.padding || 32;
      const productType = dto.productType || 'generic';
      const placement = dto.placement || 'front';

      /* ── 1. Vectoriser D'ABORD ─────────────────────────────────────────
         Lettres converties en tracés : le fichier que l'atelier découpe, et
         la réponse à « le PNG est trop pixélisé pour être utilisable » — un
         tracé n'a pas de résolution.

         Avant le PNG parce que c'est du calcul pur, sans réseau : si
         Cloudinary est indisponible, on sait au moins que la vectorisation
         a réussi, et le journal le dit. L'ordre inverse perdait cette
         information, l'échec de l'envoi du PNG masquant tout le reste.

         `genererSvgVectoriel` renvoie null (sans lever) si une police manque
         ou résiste : le texte part alors en PNG seul, jamais bloqué. */
      const svgVectoriel = await this.textOutline.genererSvgVectoriel(
        normalizedSegments,
        { scale: 1, padding },
      );

      /* ── 2. Le PNG : l'aperçu ──────────────────────────────────────────
         Il sert la vignette du dashboard, qui refuse les SVG (isImg,
         admin.view.ts) — un SVG est du XML exécutable, et ces URLs sont
         chargées automatiquement à l'ouverture de la page. Le PNG reste donc
         nécessaire, et c'est lui qui est renvoyé comme résultat principal. */
      const svgPourRendu = await this.textSvg.generateTextSvg(normalizedSegments, {
        scale,
        padding,
        backgroundColor: dto.renderOptions?.backgroundColor,
      });
      const pngBuffer = await this.textSvg.renderSvgToPng(svgPourRendu, {
        scale,
        padding,
      });
      const resultatPng = await this.cloudinary.uploadTextAsset(
        pngBuffer,
        productType,
        placement,
      );

      /* ── 3. Déposer le SVG, en supplément ──────────────────────────────
         Un échec ici ne doit pas faire échouer l'ajout au panier : le client
         resterait bloqué au paiement à cause d'un fichier destiné à
         l'atelier. On journalise et la commande continue avec le PNG. */
      let svgUrl: string | undefined;
      if (svgVectoriel) {
        try {
          const resultatSvg = await this.cloudinary.uploadTextSvgVector(
            svgVectoriel,
            productType,
            placement,
          );
          svgUrl = resultatSvg.url;
        } catch (e) {
          this.logger.warn(
            `SVG vectorisé mais non déposé (PNG conservé) : ${(e as Error).message}`,
          );
        }
      }

      return { ...resultatPng, svgUrl };
    } catch (error) {
      throw new HttpException(
        `Echec generation texte SVG: ${(error as Error).message}`,
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

  /**
   * POST /api/uploads/quote-attachment
   * Upload temporaire de pièce jointe pour devis/facture.
   * Fichiers stockés temporairement (24h) puis nettoyés automatiquement.
   */
  @Post('quote-attachment')
  @UseGuards(AdminSessionGuard) // Seuls les admins peuvent uploader
  @UseInterceptors(FileInterceptor('file'))
  async uploadQuoteAttachment(
    @UploadedFile() file: UploadedMulterFile,
  ): Promise<UploadResult & { name: string; type: string; size: number }> {
    this.assertFile(file);

    // Types de fichiers autorisés pour les pièces jointes
    const TYPES_AUTORISES = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ];
    
    const type = String(file.mimetype || '').toLowerCase();
    if (!TYPES_AUTORISES.includes(type)) {
      throw new HttpException(
        `Type de fichier non accepté (${type || 'inconnu'}). ` +
          'Formats acceptés : JPG, PNG, WEBP, GIF, PDF, DOC, DOCX, XLS, XLSX, TXT.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Limite de taille : 10 MB par fichier
    if (file.size > 10 * 1024 * 1024) {
      throw new HttpException(
        'Fichier trop volumineux (max 10 MB par fichier).',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // Upload vers Cloudinary dans un dossier temporaire
      const result = await this.cloudinary.uploadQuoteAttachment(file.buffer, file.originalname);
      return {
        ...result,
        name: file.originalname,
        type: file.mimetype,
        size: file.size
      };
    } catch (error) {
      throw new HttpException(
        `Echec upload pièce jointe: ${(error as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}