import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import sharp from 'sharp';
// Depuis sharp 0.35, le namespace de types n'est plus exposé via l'import par
// défaut : `sharp.OverlayOptions` ne résout plus. Le type est importé nommément.
import type { OverlayOptions } from 'sharp';

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

  /**
   * Hôtes dont une image peut être téléchargée par le serveur.
   *
   * Volontairement RESTREINTE aux deux CDN qui servent réellement les assets de
   * cette application, et alignée sur `IMG_HOSTS` (admin.view.ts) et
   * `ASSET_HOSTS` (admin.controller.ts).
   *
   * La liste précédente incluait `.myshopify.com`, `.shopifycdn.com` et l'apex
   * `.cloudinary.com`. Or n'importe qui crée gratuitement une boutique de
   * développement `*.myshopify.com` : les endpoints PUBLICS
   * `/api/export/preview-*` faisaient alors télécharger au serveur un contenu
   * entièrement contrôlé par un tiers — révélant l'IP du serveur et exposant
   * le décodeur d'images à un fichier piégé.
   */
  private static readonly ALLOWED_IMAGE_HOSTS = [
    'res.cloudinary.com',
    'cdn.shopify.com',
  ];

  constructor(private readonly config: ConfigService) {}

  /** Vrai si le serveur sait dessiner du texte (police présente). */
  private canRenderText = true;

  /** Configuration de cloudinary au demarrage du module. */
  onModuleInit(): void {
    cloudinary.config({
      cloud_name: this.config.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.config.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.config.get<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
    void this.checkFonts();
  }

  /**
   * Vérifie qu'une police est installée.
   *
   * sharp dessine les libellés de la planche via un SVG, et librsvg a besoin
   * d'une vraie police : sans elle, il rend des rectangles vides (les « ▯▯▯ »
   * qu'on voyait sur les aperçus). L'échec étant silencieux, on le détecte au
   * démarrage plutôt que de le découvrir sur une commande client.
   */
  private async checkFonts(): Promise<void> {
    try {
      const svg =
        `<svg width="200" height="50" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="200" height="50" fill="white"/>` +
        `<text x="100" y="35" font-family="sans-serif" font-size="26" ` +
        `font-weight="bold" fill="black" text-anchor="middle">FACE</text></svg>`;

      const { data } = await sharp(Buffer.from(svg))
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      let dark = 0;
      for (let i = 0; i < data.length; i++) if (data[i] < 128) dark++;

      this.canRenderText = dark > 150;
      if (!this.canRenderText) {
        this.logger.warn(
          'Aucune police système : les libellés des planches multi-vues ne ' +
            'seront pas dessinés (ils apparaîtraient en rectangles vides). ' +
            'Installez dejavu_fonts + fontconfig (voir nixpacks.toml).',
        );
      }
    } catch {
      this.canRenderText = false;
    }
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
   * Un hostname pointe-t-il vers une adresse interne (privée, loopback,
   * link-local) ? Bloque la forme littérale-IP la plus courante d'une SSRF.
   *
   * Ne résout pas le DNS (un nom public peut pointer vers une IP privée) : la
   * défense principale reste la liste blanche d'hôtes ci-dessous. Ce test
   * attrape les cas où l'attaquant met directement une IP interne dans l'URL,
   * dont le classique 169.254.169.254 (métadonnées cloud).
   */
  private isInternalHost(hostname: string): boolean {
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal'))
      return true;
    // IPv6 loopback / adresses locales uniques / link-local.
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80'))
      return true;
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 127 || // loopback
      a === 10 || // privé
      a === 0 ||
      (a === 169 && b === 254) || // link-local + métadonnées cloud
      (a === 192 && b === 168) || // privé
      (a === 172 && b >= 16 && b <= 31) // privé
    );
  }

  /**
   * Une URL est-elle une cible externe autorisée ?
   *
   * Ces buffers proviennent des endpoints PUBLICS /api/export/preview-* : sans
   * garde, `fetch()` sur une URL attaquant-contrôlée permettait un SSRF (scan
   * du réseau interne, accès aux métadonnées cloud). On restreint donc aux
   * CDN d'images légitimes.
   */
  private isAllowedImageUrl(url: URL): boolean {
    if (url.protocol !== 'https:') return false;
    if (this.isInternalHost(url.hostname)) return false;

    const host = url.hostname.toLowerCase();
    const store = (this.config.get<string>('SHOPIFY_STORE_URL') || '').toLowerCase();

    // La boutique configurée est toujours acceptée : c'est elle qui sert les
    // images de fond du configurateur.
    if (store && host === store) return true;

    return CloudinaryService.ALLOWED_IMAGE_HOSTS.some(
      (d) => host === d || host.endsWith('.' + d),
    );
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
    let raw = src;
    if (raw.startsWith('//')) raw = 'https:' + raw;
    else if (raw.startsWith('/')) {
      const store = this.config.get<string>('SHOPIFY_STORE_URL');
      if (store) raw = `https://${store}${raw}`;
    }

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('URL d’image invalide.');
    }
    if (!this.isAllowedImageUrl(url)) {
      // On ne renvoie PAS l'URL : l'endpoint est public et le message ne doit
      // pas confirmer à un attaquant ce qui a été atteint (oracle SSRF).
      this.logger.warn(`Chargement image refusé (hôte non autorisé) : ${url.hostname}`);
      throw new Error('Source d’image non autorisée.');
    }

    // `redirect: 'manual'` : une cible autorisée ne doit pas pouvoir rediriger
    // vers une IP interne (contournement classique de la liste blanche).
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      // Message générique + code, sans l'URL.
      throw new Error(`Impossible de charger l'image (${res.status}).`);
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
    mirror = false,
  ): Promise<{ buffer: Buffer; width: number; height: number }> {
    // 1) Fond normalise a une largeur fixe (rendu net et previsible).
    //
    // mirror : vue « manche droite ». Il n'existe qu'UNE image de profil (le
    // côté gauche) ; le côté droit est cette image retournée. Seul le FOND est
    // retourné : les logos arrivent déjà positionnés dans le repère retourné et
    // sont posés à l'endroit, sinon le design du client sortirait inversé.
    const bgBuffer = await this.loadImageBuffer(backgroundSrc);
    let bgPipeline = sharp(bgBuffer).resize(baseWidth, null, {
      fit: 'inside',
      withoutEnlargement: false,
    });
    if (mirror) bgPipeline = bgPipeline.flop(); // miroir horizontal
    const baseBuffer = await bgPipeline.png().toBuffer();
    // IMPORTANT : lire les dimensions du buffer REDIMENSIONNÉ (pas de la source).
    // sharp(x).metadata() lit l'image d'entrée, pas le résultat du resize -> il
    // faut mesurer baseBuffer, sinon les positions/tailles de logos (en fractions
    // du canvas) sont calculées sur les mauvaises dimensions (logo minuscule et
    // décalé en haut-gauche).
    const meta = await sharp(baseBuffer).metadata();
    const canvasW = meta.width || baseWidth;
    const canvasH = meta.height || baseWidth;

    // 2) Prepare chaque logo redimensionne a sa largeur cible.
    const overlays: OverlayOptions[] = [];
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
      mirror?: boolean;
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
        const composed = await this.composeViewBuffer(
          v.background,
          v.logos || [],
          CELL,
          !!v.mirror,
        );
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
    const overlays: OverlayOptions[] = [];
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
        // Sans police, librsvg dessinerait des rectangles vides : mieux vaut
        // une vue sans légende qu'une légende illisible.
        if (cell.label && this.canRenderText) {
          const cx = colX + CELL / 2;
          const ly = yCursor + cell.h + 28;
          svgLabels.push(
            `<text x="${cx}" y="${ly}" font-family="'DejaVu Sans','Liberation Sans',sans-serif" font-size="22" font-weight="bold" fill="#1a1a1a" text-anchor="middle">${this.escapeXml(cell.label)}</text>`,
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
