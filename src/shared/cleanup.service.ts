import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { Quote } from '../database/entities/quote.entity';
import { CloudinaryService } from './cloudinary.service';
import { ressourceDepuisUrl } from './piece-jointe-cloudinary';

/**
 * Durée de conservation d'une pièce jointe de facture.
 *
 * Ses liens partent dans l'e-mail de facture PUIS dans chaque relance
 * (pieces-jointes.ts) : les supprimer 48 h après l'upload, comme avant,
 * cassait les liens des relances de J+3, J+7, J+14. 60 jours couvrent le
 * cycle de relances et laissent au client le temps de relire son devis.
 */
export const RETENTION_PIECES_MS = 60 * 24 * 60 * 60 * 1000;

/** Devis examinés par passe (la table n'a pas d'index sur ce critère). */
const LOT_NETTOYAGE = 200;

type Piece = NonNullable<Quote['tempAttachments']>[number];

/** Pièces expirées / à garder, selon leur date d'upload. Sans date : expirée. */
export function trierPieces(
  pieces: Piece[],
  maintenant: number,
  retentionMs = RETENTION_PIECES_MS,
): { expirees: Piece[]; gardees: Piece[] } {
  const expirees: Piece[] = [];
  const gardees: Piece[] = [];
  for (const p of pieces) {
    const t = Date.parse(String(p?.uploadedAt ?? ''));
    (Number.isFinite(t) && maintenant - t <= retentionMs ? gardees : expirees).push(p);
  }
  return { expirees, gardees };
}

/**
 * Nettoyage périodique des pièces jointes de facture (Cloudinary).
 *
 * Corrigé sur trois points :
 *  - PÉRIMÈTRE : seuls les devis `draftStatus = 'open'` étaient examinés, or
 *    les pièces ne sont enregistrées qu'à l'envoi de la facture, qui passe le
 *    devis en `invoice_sent` — elles n'étaient donc jamais nettoyées. Tout
 *    devis portant des pièces est désormais examiné.
 *  - ÉCHEC DE SUPPRESSION : la référence était retirée quand même, et le
 *    fichier restait en ligne sans plus personne pour le retrouver. Elle est
 *    maintenant gardée, pour réessayer à la passe suivante.
 *  - URL : seules les URL de NOTRE compte Cloudinary sont supprimées.
 */
@Injectable()
export class CleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CleanupService.name);
  private cleanupTimer?: NodeJS.Timeout;
  private startTimer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(Quote)
    private readonly quotes: Repository<Quote>,
    private readonly cloudinary: CloudinaryService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Premier passage après 5 minutes, puis toutes les 6 heures.
    this.startTimer = setTimeout(() => void this.cleanupExpiredAttachments(), 5 * 60 * 1000);
    this.cleanupTimer = setInterval(
      () => void this.cleanupExpiredAttachments(),
      6 * 60 * 60 * 1000,
    );
  }

  onModuleDestroy(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  /** Supprime les pièces jointes expirées. Ne lève jamais. */
  async cleanupExpiredAttachments(): Promise<{ cleaned: number; errors: number }> {
    if (this.running) return { cleaned: 0, errors: 0 };
    this.running = true;
    let cleaned = 0;
    let errors = 0;
    try {
      const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME') || undefined;
      const devis = await this.quotes.find({
        where: { tempAttachments: Not(IsNull()) },
        select: { id: true, tempAttachments: true },
        take: LOT_NETTOYAGE,
      });

      const maintenant = Date.now();
      for (const quote of devis) {
        const pieces = Array.isArray(quote.tempAttachments) ? quote.tempAttachments : [];
        const { expirees, gardees } = trierPieces(pieces, maintenant);
        if (!expirees.length) continue;

        const restantes = [...gardees];
        for (const piece of expirees) {
          const ressource = ressourceDepuisUrl(piece?.url, cloudName);
          if (!ressource) {
            // Pas une URL de notre compte : rien à supprimer chez nous.
            continue;
          }
          try {
            await this.cloudinary.deleteResource(ressource.publicId, ressource.resourceType);
            cleaned++;
          } catch (e) {
            errors++;
            restantes.push(piece); // gardée : on réessaiera
            this.logger.warn(
              `Pièce jointe ${piece?.name} non supprimée : ${(e as Error).message}`,
            );
          }
        }

        /* Écriture conditionnelle : si les pièces du devis ont changé pendant
           la passe (nouvel envoi de facture), on n'écrase pas la nouvelle liste
           avec une liste périmée. */
        await this.quotes
          .createQueryBuilder()
          .update(Quote)
          .set({ tempAttachments: restantes.length ? restantes : null })
          .where('id = :id', { id: quote.id })
          // Liste INCHANGÉE depuis la lecture (même contenu, pas seulement même
          // nombre) : sinon un renvoi de facture serait écrasé par une liste périmée.
          .andWhere('JSON_LENGTH(tempAttachments) = :n', { n: pieces.length })
          .andWhere('JSON_CONTAINS(tempAttachments, CAST(:avant AS JSON))', {
            avant: JSON.stringify(pieces),
          })
          .execute();
      }

      if (cleaned || errors) {
        this.logger.log(`Nettoyage des pièces jointes : ${cleaned} supprimée(s), ${errors} erreur(s).`);
      }
    } catch (e) {
      errors++;
      this.logger.error(`Nettoyage des pièces jointes impossible : ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
    return { cleaned, errors };
  }

  /** Force le nettoyage immédiat (tests, maintenance). */
  async forceCleanup(): Promise<{ cleaned: number; errors: number }> {
    return this.cleanupExpiredAttachments();
  }
}
