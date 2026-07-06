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
    const res = await fetch(src);
    if (!res.ok) {
      throw new Error(`Impossible de charger l'image (${res.status}): ${src}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Compose une image d'apercu : fond (produit) + logos superposes,
   * puis l'envoie sur Cloudinary. Les positions/tailles des logos sont
   * exprimees en fractions (0..1) du fond, comme dans le configurateur.
   */
  async composeAndUploadPreview(
    backgroundSrc: string,
    logos: Array<{ src: string; x: number; y: number; w: number }>,
  ): Promise<UploadResult> {
    // 1) Fond normalise a une largeur fixe (rendu net et previsible).
    const baseWidth = 1000;
    const bgBuffer = await this.loadImageBuffer(backgroundSrc);
    const base = sharp(bgBuffer).resize(baseWidth, null, {
      fit: 'inside',
      withoutEnlargement: false,
    });
    const meta = await base.metadata();
    const canvasW = meta.width || baseWidth;
    const canvasH = meta.height || baseWidth;
    const baseBuffer = await base.png().toBuffer();

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

    // 3) Composite + upload.
    const composed = await sharp(baseBuffer)
      .composite(overlays)
      .jpeg({ quality: 88 })
      .toBuffer();

    return this.uploadImage(composed, {
      folder: 'customizer/shares',
      public_id: `share_${Date.now()}`,
      format: 'jpg',
    });
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
