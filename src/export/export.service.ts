import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Design } from '../database/entities/design.entity';

@Injectable()
export class ExportService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Design)
    private readonly designs: Repository<Design>,
  ) {}

  /**
   * Genere un identifiant de partage et memorise le design en base.
   * Retourne l'id et l'URL de partage vers le configurateur frontend.
   */
  async createShare(designData: Record<string, unknown>): Promise<{
    shareId: string;
    shareUrl: string;
  }> {
    const shareId = randomUUID();

    // On tente d'extraire le type de produit pour faciliter le filtrage admin.
    const productType =
      (designData?.product as string) ||
      (designData?.productType as string) ||
      null;

    await this.designs.save(
      this.designs.create({
        id: shareId,
        productType,
        designData,
      }),
    );

    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const shareUrl = `${frontendUrl}/pages/configurateur?design=${shareId}`;

    return { shareId, shareUrl };
  }

  /** Recupere un design partage par son id. */
  async getShare(shareId: string): Promise<Record<string, unknown>> {
    const stored = await this.designs.findOne({ where: { id: shareId } });
    if (!stored) {
      throw new NotFoundException('Design partage introuvable ou expire.');
    }
    return stored.designData;
  }

  /** Liste tous les designs (pour le futur dashboard admin — étape 3). */
  async findAll(): Promise<Design[]> {
    return this.designs.find({ order: { createdAt: 'DESC' } });
  }
}
