import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

export interface TextSegmentData {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle?: string;
  color: string;
  underline?: boolean;
}

export interface TextDimensions {
  width: number;
  height: number;
  segments: Array<{
    text: string;
    width: number;
    x: number;
  }>;
}

export interface RenderOptions {
  scale: number;
  padding: number;
  backgroundColor?: string;
}

/**
 * Service de génération SVG haute résolution pour texte personnalisé.
 * 
 * Remplace la rasterisation canvas côté client par un rendu vectoriel serveur,
 * éliminant la pixellisation du texte dans les assets finaux.
 */
@Injectable()
export class TextSvgService {
  private readonly logger = new Logger(TextSvgService.name);

  /**
   * Génère un SVG à partir de segments de texte avec mise en forme individuelle.
   * Chaque segment peut avoir sa propre police, couleur, style (gras, italique, souligné).
   */
  async generateTextSvg(
    segments: TextSegmentData[],
    options: RenderOptions = { scale: 2, padding: 32 },
  ): Promise<string> {
    if (!segments || segments.length === 0) {
      throw new Error('Aucun segment de texte fourni');
    }

    // Calcul des dimensions totales et positions des segments
    const dimensions = this.calculateTextDimensions(segments, options.scale);
    
    // Dimensions du SVG avec padding
    const svgWidth = dimensions.width + (options.padding * 2);
    const svgHeight = dimensions.height + (options.padding * 2);
    
    // Position de base du texte (centré verticalement)
    const baseY = (svgHeight / 2) + (dimensions.height * 0.35); // Baseline approximative
    const startX = options.padding;

    // Construction des éléments SVG pour chaque segment
    const textElements: string[] = [];
    const underlineElements: string[] = [];
    
    let currentX = startX;
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segmentDim = dimensions.segments[i];
      
      // Élément texte avec styles individuels
      const fontStyle = segment.fontStyle === 'italic' ? 'italic' : 'normal';
      const textDecoration = segment.underline ? 'underline' : 'none';
      
      textElements.push(`
        <text 
          x="${currentX}" 
          y="${baseY}"
          font-family="${this.escapeXml(segment.fontFamily)}"
          font-size="${segment.fontSize * options.scale}"
          font-weight="${segment.fontWeight}"
          font-style="${fontStyle}"
          fill="${this.escapeXml(segment.color)}"
          text-decoration="${textDecoration}"
          dominant-baseline="alphabetic"
        >${this.escapeXml(segment.text)}</text>
      `);
      
      // Trait de soulignement manuel si nécessaire (plus de contrôle que text-decoration)
      if (segment.underline) {
        const underlineY = baseY + (segment.fontSize * options.scale * 0.1);
        const strokeWidth = Math.max(1, segment.fontSize * options.scale * 0.05);
        
        underlineElements.push(`
          <line 
            x1="${currentX}" 
            y1="${underlineY}" 
            x2="${currentX + segmentDim.width}" 
            y2="${underlineY}"
            stroke="${this.escapeXml(segment.color)}"
            stroke-width="${strokeWidth}"
          />
        `);
      }
      
      currentX += segmentDim.width;
    }

    // Construction du SVG complet
    const backgroundColor = options.backgroundColor || 'transparent';
    const backgroundRect = backgroundColor !== 'transparent' 
      ? `<rect width="100%" height="100%" fill="${backgroundColor}"/>` 
      : '';

    const svgContent = `
      <svg 
        width="${svgWidth}" 
        height="${svgHeight}" 
        xmlns="http://www.w3.org/2000/svg"
        xmlns:xlink="http://www.w3.org/1999/xlink"
      >
        ${backgroundRect}
        ${textElements.join('')}
        ${underlineElements.join('')}
      </svg>
    `.trim();

    this.logger.debug(`SVG généré: ${svgWidth}x${svgHeight}px, ${segments.length} segments`);
    return svgContent;
  }

  /**
   * Convertit un SVG en PNG haute résolution via Sharp.
   */
  async renderSvgToPng(
    svgString: string, 
    options: RenderOptions = { scale: 2, padding: 32 }
  ): Promise<Buffer> {
    try {
      const svgBuffer = Buffer.from(svgString, 'utf-8');
      
      // Conversion SVG → PNG avec Sharp
      // Sharp gère nativement le SVG et produit un rendu de haute qualité
      const pngBuffer = await sharp(svgBuffer)
        .png({ 
          quality: 100, 
          compressionLevel: 0,  // Pas de compression pour texte
          palette: false        // Force RGB complet
        })
        .toBuffer();

      this.logger.debug(`PNG généré depuis SVG: ${pngBuffer.length} bytes`);
      return pngBuffer;
      
    } catch (error) {
      this.logger.error(`Erreur conversion SVG→PNG: ${(error as Error).message}`);
      throw new Error(`Échec du rendu SVG: ${(error as Error).message}`);
    }
  }

  /**
   * Calcule les dimensions approximatives du texte rendu.
   * Utilise des métriques de police approximatives (pas de canvas).
   */
  private calculateTextDimensions(
    segments: TextSegmentData[], 
    scale: number
  ): TextDimensions {
    const segmentDimensions = segments.map(segment => {
      // Estimation de largeur basée sur la taille de police et le nombre de caractères
      // Facteur approximatif: 0.6 * fontSize pour largeur moyenne d'un caractère
      const avgCharWidth = segment.fontSize * scale * 0.6;
      const segmentWidth = segment.text.length * avgCharWidth;
      
      // Ajustement pour gras (environ 10% plus large)
      const weightMultiplier = (segment.fontWeight === 'bold' || 
                                parseInt(segment.fontWeight) >= 600) ? 1.1 : 1.0;
      
      // Ajustement pour italique (léger élargissement)
      const styleMultiplier = segment.fontStyle === 'italic' ? 1.05 : 1.0;
      
      const finalWidth = segmentWidth * weightMultiplier * styleMultiplier;
      
      return {
        text: segment.text,
        width: finalWidth,
        x: 0 // Sera calculé dans la boucle principale
      };
    });

    // Calcul de la largeur totale
    const totalWidth = segmentDimensions.reduce((sum, seg) => sum + seg.width, 0);
    
    // Hauteur basée sur la plus grande police
    const maxFontSize = Math.max(...segments.map(s => s.fontSize));
    const totalHeight = maxFontSize * scale;

    // Mise à jour des positions X
    let currentX = 0;
    segmentDimensions.forEach(seg => {
      seg.x = currentX;
      currentX += seg.width;
    });

    return {
      width: totalWidth,
      height: totalHeight,
      segments: segmentDimensions
    };
  }

  /**
   * Échappe les caractères XML/SVG dangereux.
   */
  private escapeXml(text: string): string {
    if (typeof text !== 'string') return '';
    
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Valide qu'une police est utilisable pour le rendu SVG.
   * Peut être étendu pour vérifier la disponibilité des polices système.
   */
  validateFont(fontFamily: string): boolean {
    // Polices de base toujours disponibles
    const safeFonts = [
      'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
      'Arial', 'Helvetica', 'Times', 'Courier', 'Verdana'
    ];
    
    const normalizedFont = fontFamily.toLowerCase().replace(/['"]/g, '');
    return safeFonts.some(safe => 
      normalizedFont.includes(safe.toLowerCase())
    );
  }

  /**
   * Normalise les paramètres de police pour compatibilité SVG.
   */
  normalizeFontParams(segment: TextSegmentData): TextSegmentData {
    return {
      ...segment,
      fontFamily: segment.fontFamily || 'sans-serif',
      fontSize: Math.max(8, Math.min(300, segment.fontSize || 16)), // Bornes raisonnables
      fontWeight: this.normalizeFontWeight(segment.fontWeight),
      color: this.normalizeColor(segment.color)
    };
  }

  private normalizeFontWeight(weight: string | number): string {
    if (typeof weight === 'number') return weight.toString();
    if (weight === 'bold') return '700';
    if (weight === 'normal') return '400';
    return weight || '400';
  }

  private normalizeColor(color: string): string {
    if (!color) return '#000000';
    
    // Couleurs nommées courantes → hex
    const namedColors: Record<string, string> = {
      'black': '#000000',
      'white': '#ffffff', 
      'red': '#ff0000',
      'blue': '#0000ff',
      'green': '#008000'
    };
    
    const lowerColor = color.toLowerCase();
    if (namedColors[lowerColor]) return namedColors[lowerColor];
    
    // Déjà en format hex/rgb/rgba
    if (color.match(/^#[0-9a-f]{3,8}$/i) || 
        color.match(/^rgb\(/i) || 
        color.match(/^rgba\(/i)) {
      return color;
    }
    
    // Fallback
    return '#000000';
  }
}