import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

interface StoredDesign {
  designData: Record<string, unknown>;
  createdAt: string;
}

@Injectable()
export class ExportService {
  // TODO: brancher un stockage persistant (BDD/Redis). Stockage en memoire pour l'instant.
  private readonly designs = new Map<string, StoredDesign>();

  constructor(private readonly config: ConfigService) {}

  /**
   * Genere un identifiant de partage et memorise le design.
   * Retourne l'id et l'URL de partage vers le configurateur frontend.
   */
  createShare(designData: Record<string, unknown>): {
    shareId: string;
    shareUrl: string;
  } {
    const shareId = randomUUID();
    this.designs.set(shareId, {
      designData,
      createdAt: new Date().toISOString(),
    });

    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const shareUrl = `${frontendUrl}/pages/configurateur?design=${shareId}`;

    return { shareId, shareUrl };
  }

  /** Recupere un design partage par son id. */
  getShare(shareId: string): Record<string, unknown> {
    const stored = this.designs.get(shareId);
    if (!stored) {
      throw new NotFoundException('Design partage introuvable ou expire.');
    }
    return stored.designData;
  }
}
