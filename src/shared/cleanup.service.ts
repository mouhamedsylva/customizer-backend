import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Quote } from '../database/entities/quote.entity';
import { CloudinaryService } from './cloudinary.service';

/**
 * Service de nettoyage automatique des pièces jointes temporaires.
 * 
 * Les pièces jointes uploadées pour les devis sont stockées temporairement
 * dans Cloudinary et supprimées automatiquement après 48h pour éviter
 * l'accumulation de fichiers inutiles.
 */
@Injectable()
export class CleanupService implements OnModuleInit {
  private readonly logger = new Logger(CleanupService.name);
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(Quote)
    private readonly quotes: Repository<Quote>,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /**
   * Démarre le nettoyage automatique au démarrage du module.
   * Nettoyage initial différé puis répété toutes les 6 heures.
   */
  onModuleInit(): void {
    // Premier nettoyage après 5 minutes (laisser le temps au système de démarrer)
    setTimeout(() => {
      void this.cleanupExpiredAttachments();
    }, 5 * 60 * 1000);

    // Nettoyage récurrent toutes les 6 heures
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredAttachments();
    }, 6 * 60 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  /**
   * Nettoie les pièces jointes temporaires expirées (> 48h).
   * 
   * Les pièces jointes sont considérées comme temporaires si :
   * - Elles sont stockées dans tempAttachments
   * - Elles datent de plus de 48h
   * - Le devis n'a pas encore été facturé (draftStatus !== 'invoice_sent')
   */
  async cleanupExpiredAttachments(): Promise<{ cleaned: number; errors: number }> {
    this.logger.log('Début du nettoyage des pièces jointes temporaires');
    
    try {
      // Trouve les devis avec des pièces jointes temporaires expirées
      const expirationDate = new Date();
      expirationDate.setHours(expirationDate.getHours() - 48); // 48h avant maintenant
      
      const quotesWithExpiredAttachments = await this.quotes.find({
        where: {
          // Ne nettoie que les devis non encore facturés
          draftStatus: 'open',
          // Créés il y a plus de 48h (approximation)
          createdAt: LessThan(expirationDate)
        },
        select: {
          id: true,
          tempAttachments: true,
          createdAt: true
        }
      });

      let cleaned = 0;
      let errors = 0;

      for (const quote of quotesWithExpiredAttachments) {
        if (!quote.tempAttachments || quote.tempAttachments.length === 0) {
          continue;
        }

        const expiredAttachments = quote.tempAttachments.filter(attachment => {
          if (!attachment.uploadedAt) return true; // Pas de date = nettoyage
          
          const uploadedAt = new Date(attachment.uploadedAt);
          const age = Date.now() - uploadedAt.getTime();
          const expiredMs = 48 * 60 * 60 * 1000; // 48h en millisecondes
          
          return age > expiredMs;
        });

        if (expiredAttachments.length === 0) {
          continue;
        }

        // Supprime les fichiers de Cloudinary
        for (const attachment of expiredAttachments) {
          try {
            if (attachment.url) {
              // Extrait le public_id de l'URL Cloudinary
              const publicId = this.extractPublicId(attachment.url);
              if (publicId) {
                await this.cloudinary.deleteResource(publicId);
                cleaned++;
                this.logger.debug(`Fichier supprimé: ${attachment.name} (${publicId})`);
              }
            }
          } catch (error) {
            this.logger.warn(
              `Erreur suppression fichier ${attachment.name}: ${(error as Error).message}`
            );
            errors++;
          }
        }

        // Met à jour le devis pour supprimer les pièces jointes expirées
        const remainingAttachments = quote.tempAttachments.filter(attachment => {
          return !expiredAttachments.some(expired => expired.url === attachment.url);
        });

        await this.quotes.update(quote.id, {
          tempAttachments: remainingAttachments.length > 0 ? remainingAttachments : null
        });
      }

      this.logger.log(
        `Nettoyage terminé: ${cleaned} fichiers supprimés, ${errors} erreurs`
      );
      
      return { cleaned, errors };

    } catch (error) {
      this.logger.error(
        `Erreur lors du nettoyage des pièces jointes: ${(error as Error).message}`
      );
      return { cleaned: 0, errors: 1 };
    }
  }

  /**
   * Extrait le public_id d'une URL Cloudinary.
   * Exemple: https://res.cloudinary.com/cloud/image/upload/v123/folder/file.ext -> folder/file
   */
  private extractPublicId(url: string): string | null {
    try {
      const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.(jpg|jpeg|png|gif|pdf|doc|docx|xls|xlsx|txt)$/i);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * Force le nettoyage immédiat (pour les tests ou la maintenance).
   */
  async forceCleanup(): Promise<{ cleaned: number; errors: number }> {
    this.logger.log('Nettoyage forcé des pièces jointes temporaires');
    return this.cleanupExpiredAttachments();
  }
}