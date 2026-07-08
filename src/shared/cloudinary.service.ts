import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import sharp from 'sharp';

export interface UploadResult {
  url: string;
  publicId: string;
  width: number;
  height: number;
  format?: string;
  bytes?: number;
}

interface UploadOptions {
  folder?: string;
  public_id?: string;
  format?: string;
}

/**
 * Service d'upload vers Cloudinary + optimisation sharp.
 * Adapte depuis l'ancien customizer-api/src/services/cloudinary.service.js.
 */
@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly config: ConfigService) {}

  /** Configuration de cloudinary au demarrage du module. */
  onModuleInit(): void {
    cloudinary.config({
      cloud_name: this.config.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.config.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.config.get<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
  }

  /**
   * Upload d'un buffer image via un upload_stream Cloudinary.
   */
  private uploadImage(
    fileBuffer: Buffer,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    return new Promise<UploadResult>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder || 'customizer',
          public_id: options.public_id,
          resource_type: 'image',
          format: options.format || 'png',
        },
        (error, result?: UploadApiResponse) => {
          if (error || !result) {
            reject(error || new Error('Upload Cloudinary sans resultat'));
            return;
          }
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
            bytes: result.bytes,
          });
        },
      );

      uploadStream.end(fileBuffer);
    });
  }

  /**
   * Optimise un logo (resize <= 2000x2000, PNG q90) et l'envoie sur Cloudinary.
   */
  async uploadLogo(
    fileBuffer: Buffer,
    productType = 'generic',
    placement = 'front',
  ): Promise<UploadResult> {
    const optimized = await sharp(fileBuffer)
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .png({ quality: 90 })
      .toBuffer();

    return this.uploadImage(optimized, {
      folder: `customizer/logos/${productType}`,
      public_id: `logo_${placement}_${Date.now()}`,
    });
  }

  /**
   * Optimise une preview (resize <= 1200x1200, JPEG q85) et l'envoie sur Cloudinary.
   */
  async uploadPreview(
    fileBuffer: Buffer,
    designId = `${Date.now()}`,
  ): Promise<UploadResult> {
    const optimized = await sharp(fileBuffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    return this.uploadImage(optimized, {
      folder: 'customizer/previews',
      public_id: `preview_${designId}`,
      format: 'jpg',
    });
  }

  /**
   * Charge un buffer image depuis une URL http(s) ou une data-URL base64.
   */
  private async loadImageBuffer(src: string): Promise<Buffer> {
    if (src.startsWith('data:')) {
      const base64 = src.split(',')[1] || '';
      return Buffer.from(base64, 'base64');
    }
    // Les asset_url Shopify sont souvent protocole-relatifs (//cdn.shopify...).
    // fetch() de Node ne sait pas les parser -> on force https://.
    let url = src;
    if (url.startsWith('//')) url = 'https:' + url;
    else if (url.startsWith('/')) {
      const store = this.config.get<string>('SHOPIFY_STORE_URL');
      if (store) url = `https://${store}${url}`;
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Impossible de charger l'image (${res.status}): ${url}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Compose UNE vue (fond produit + logos superposes) en un buffer PNG.
   * Positions/tailles des logos en fractions (0..1) du fond, comme le configurateur.
   * baseWidth : largeur de rendu du fond (netteté).
   */
  private async composeViewBuffer(
    backgroundSrc: string,
    logos: Array<{ src: string; x: number; y: number; w: number }>,
    baseWidth = 1500,
  ): Promise<{ buffer: Buffer; width: number; height: number }> {
    // 1) Fond normalise a une largeur fixe (rendu net et previsible).
    const bgBuffer = await this.loadImageBuffer(backgroundSrc);
    const baseBuffer = await sharp(bgBuffer)
      .resize(baseWidth, null, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
    // IMPORTANT : lire les dimensions du buffer REDIMENSIONNÉ (pas de la source).
    // sharp(x).metadata() lit l'image d'entrée, pas le résultat du resize -> il
    // faut mesurer baseBuffer, sinon les positions/tailles de logos (en fractions
    // du canvas) sont calculées sur les mauvaises dimensions (logo minuscule et
    // décalé en haut-gauche).
    const meta = await sharp(baseBuffer).metadata();
    const canvasW = meta.width || baseWidth;
    const canvasH = meta.height || baseWidth;

    // 2) Prepare chaque logo redimensionne a sa largeur cible.
    const overlays: sharp.OverlayOptions[] = [];
    for (const logo of logos || []) {
      if (!logo || !logo.src) continue;
      try {
        const logoBuffer = await this.loadImageBuffer(logo.src);
        const targetW = Math.max(1, Math.round((logo.w || 0.1) * canvasW));
        const resized = await sharp(logoBuffer)
          .resize(targetW, null, { fit: 'inside', withoutEnlargement: false })
          .png()
          .toBuffer();
        const lMeta = await sharp(resized).metadata();
        const left = Math.round((logo.x || 0) * canvasW);
        const top = Math.round((logo.y || 0) * canvasH);
        overlays.push({
          input: resized,
          left: Math.min(Math.max(0, left), canvasW - (lMeta.width || 1)),
          top: Math.min(Math.max(0, top), canvasH - (lMeta.height || 1)),
        });
      } catch (error) {
        this.logger.warn(`Logo ignore dans la composition: ${(error as Error).message}`);
      }
    }

    // 3) Composite. PNG pour préserver la transparence (pas de fond noir).
    const composed = await sharp(baseBuffer).composite(overlays).png().toBuffer();
    return { buffer: composed, width: canvasW, height: canvasH };
  }

  /**
   * Compose une image d'apercu : fond (produit) + logos superposes,
   * puis l'envoie sur Cloudinary.
   */
  async composeAndUploadPreview(
    backgroundSrc: string,
    logos: Array<{ src: string; x: number; y: number; w: number }>,
  ): Promise<UploadResult> {
    const { buffer } = await this.composeViewBuffer(backgroundSrc, logos);
    return this.uploadImage(buffer, {
      folder: 'customizer/shares',
      public_id: `share_${Date.now()}`,
      format: 'png',
    });
  }

  /**
   * Compose plusieurs vues (face/dos/côté) en une seule image "planche" :
   * chaque vue est rendue puis placee dans une grille (2 par rangee), avec un
   * libelle sous chaque vue. Fond blanc, sortie JPEG (planche opaque = ok).
   */
  async composeMultiViewAndUpload(
    views: Array<{
      label?: string;
      background: string;
      logos?: Array<{ src: string; x: number; y: number; w: number }>;
    }>,
  ): Promise<UploadResult> {
    const CELL = 700; // largeur de rendu de chaque vue dans la planche
    const GAP = 24; // espace entre cellules
    const LABEL_H = 44; // bande pour le libellé sous chaque vue
    const PAD = 32; // marge autour de la planche

    // 1) Compose chaque vue et normalise sa largeur à CELL.
    const cells: Array<{ buffer: Buffer; w: number; h: number; label: string }> = [];
    for (const v of views || []) {
      if (!v || !v.background) continue;
      try {
        const composed = await this.composeViewBuffer(v.background, v.logos || [], CELL);
        // Redimensionne à CELL de large (composeViewBuffer rend déjà à CELL, mais
        // on garantit la largeur exacte pour l'alignement de la grille).
        const resized = await sharp(composed.buffer)
          .resize(CELL, null, { fit: 'inside' })
          .png()
          .toBuffer();
        const m = await sharp(resized).metadata();
        cells.push({
          buffer: resized,
          w: m.width || CELL,
          h: m.height || CELL,
          label: v.label || '',
        });
      } catch (error) {
        this.logger.warn(`Vue ignoree dans la planche: ${(error as Error).message}`);
      }
    }

    if (!cells.length) {
      throw new Error('Aucune vue composable pour la planche multi-vues.');
    }

    // 2) Grille : 2 colonnes. Hauteur de rangée = plus haute cellule + libellé.
    const cols = cells.length === 1 ? 1 : 2;
    const rows = Math.ceil(cells.length / cols);
    const rowHeights: number[] = [];
    for (let r = 0; r < rows; r++) {
      let maxH = 0;
      for (let c = 0; c < cols; c++) {
        const cell = cells[r * cols + c];
        if (cell) maxH = Math.max(maxH, cell.h);
      }
      rowHeights.push(maxH + LABEL_H);
    }

    const boardW = PAD * 2 + cols * CELL + (cols - 1) * GAP;
    const boardH =
      PAD * 2 + rowHeights.reduce((s, h) => s + h, 0) + (rows - 1) * GAP;

    // 3) Place chaque vue (centrée horizontalement dans sa colonne) + libellé.
    const overlays: sharp.OverlayOptions[] = [];
    const svgLabels: string[] = [];
    let yCursor = PAD;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const cell = cells[idx];
        if (!cell) continue;
        const colX = PAD + c * (CELL + GAP);
        const left = colX + Math.round((CELL - cell.w) / 2);
        overlays.push({ input: cell.buffer, left, top: yCursor });
        if (cell.label) {
          const cx = colX + CELL / 2;
          const ly = yCursor + cell.h + 28;
          svgLabels.push(
            `<text x="${cx}" y="${ly}" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#1a1a1a" text-anchor="middle">${this.escapeXml(cell.label)}</text>`,
          );
        }
      }
      yCursor += rowHeights[r] + GAP;
    }

    if (svgLabels.length) {
      const svg = `<svg width="${boardW}" height="${boardH}" xmlns="http://www.w3.org/2000/svg">${svgLabels.join('')}</svg>`;
      overlays.push({ input: Buffer.from(svg), left: 0, top: 0 });
    }

    // 4) Planche finale sur fond blanc -> JPEG (opaque, léger).
    const board = await sharp({
      create: {
        width: boardW,
        height: boardH,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite(overlays)
      .jpeg({ quality: 90 })
      .toBuffer();

    return this.uploadImage(board, {
      folder: 'customizer/shares',
      public_id: `share_multi_${Date.now()}`,
      format: 'jpg',
    });
  }

  /** Echappe le texte pour un usage sûr dans un SVG. */
  private escapeXml(s: string): string {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Supprime une image de Cloudinary par son public_id.
   */
  async deleteImage(publicId: string): Promise<boolean> {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      return result.result === 'ok';
    } catch (error) {
      this.logger.error(`Erreur suppression Cloudinary: ${(error as Error).message}`);
      throw new Error(`Erreur suppression Cloudinary: ${(error as Error).message}`);
    }
  }
}
