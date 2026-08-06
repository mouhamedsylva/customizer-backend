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
    //
    // `designData` n'est validé que par `@IsObject()` : son contenu est
    // entièrement libre. Le `as string` d'origine était un mensonge au
    // compilateur — un objet donnait « [object Object] » en base, et une chaîne
    // de plus de 64 caractères dépassait la colonne, provoquant une 500 non
    // gérée sur un endpoint PUBLIC. On ne retient donc qu'une vraie chaîne,
    // tronquée à la taille de la colonne.
    // `||` et non `??` : le repli doit aussi jouer sur une CHAÎNE VIDE. Avec
    // `??`, un `product: ''` (select non renseigné, champ effacé) bloquait le
    // repli vers `productType`, qui portait pourtant la bonne valeur.
    const rawType = designData?.product || designData?.productType;
    const productType =
      typeof rawType === 'string' && rawType.trim()
        ? rawType.trim().slice(0, 64)
        : null;

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

}
