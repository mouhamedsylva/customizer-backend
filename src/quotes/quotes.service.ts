import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EmailService, QuoteEmailData } from '../shared/email.service';
import {
  CreateDraftOrderPayload,
  ShopifyService,
} from '../shared/shopify.service';
import { CreateQuoteDto } from './dto/create-quote.dto';

export interface StoredQuote extends CreateQuoteDto {
  quoteId: string;
  createdAt: string;
  draftOrderId?: string | number;
}

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  // TODO: brancher une vraie base de donnees. Stockage en memoire pour l'instant.
  private readonly quotes = new Map<string, StoredQuote>();

  constructor(
    private readonly email: EmailService,
    private readonly shopify: ShopifyService,
  ) {}

  /**
   * Cree une demande de devis :
   *  - draft order Shopify (visible dans Admin > Commandes > Brouillons)
   *  - email a l'equipe + accuse de reception au client
   * Le draft et les emails sont "best effort" : la demande est toujours
   * enregistree et la reponse HTTP part immediatement.
   */
  async create(
    dto: CreateQuoteDto,
  ): Promise<{ success: boolean; quoteId: string }> {
    const quoteId = randomUUID();

    const emailData: QuoteEmailData = {
      customerName: dto.customer.nom,
      email: dto.customer.email,
      telephone: dto.customer.telephone,
      entreprise: dto.customer.entreprise,
      message: dto.customer.message,
      coinName: dto.coin.name,
      details: dto.coin.details,
      qty: dto.coin.qty,
      previews: dto.coin.previews,
      quoteId,
    };

    // On enregistre TOUJOURS la demande, même si l'email/Shopify échoue.
    this.quotes.set(quoteId, {
      ...dto,
      quoteId,
      createdAt: new Date().toISOString(),
    });

    // Draft order Shopify puis emails, APRÈS avoir répondu au client
    // (setImmediate détache le traitement de la requête HTTP courante).
    setImmediate(() => {
      void this.processQuoteBestEffort(dto, quoteId, emailData);
    });

    return { success: true, quoteId };
  }

  /** Crée le draft order Shopify puis envoie les emails, sans bloquer la réponse. */
  private async processQuoteBestEffort(
    dto: CreateQuoteDto,
    quoteId: string,
    emailData: QuoteEmailData,
  ): Promise<void> {
    // 1) Draft order Shopify (devis visible dans l'admin)
    try {
      const draftOrder = await this.shopify.createDraftOrder(
        this.buildDraftPayload(dto, quoteId),
      );
      const stored = this.quotes.get(quoteId);
      if (stored) stored.draftOrderId = draftOrder.id;
      this.logger.log(
        `Devis ${quoteId} -> draft order Shopify #${draftOrder.id}`,
      );
    } catch (error) {
      this.logger.warn(
        `Devis ${quoteId} : draft order Shopify non créé: ${(error as Error).message}`,
      );
    }

    // 2) Emails (équipe + accusé client)
    await this.sendEmailsBestEffort(dto.customer.email, emailData);
  }

  /** Construit le payload du draft order Shopify à partir du devis. */
  private buildDraftPayload(
    dto: CreateQuoteDto,
    quoteId: string,
  ): CreateDraftOrderPayload {
    const { customer, coin } = dto;

    // Propriétés visibles sur la ligne du brouillon : détails du coin,
    // référence devis, et URLs des aperçus (recto/verso/côté).
    const properties: Array<{ name: string; value: string }> = [];
    properties.push({ name: 'Référence devis', value: quoteId });
    coin.details.forEach((d, i) => {
      properties.push({ name: `Détail ${i + 1}`, value: d });
    });
    coin.previews.forEach((p) => {
      if (p.base) properties.push({ name: `Aperçu ${p.label}`, value: p.base });
      if (p.logo) properties.push({ name: `Logo ${p.label}`, value: p.logo });
    });

    // Le formulaire de devis n'a qu'un champ "nom complet" : on le découpe.
    const parts = (customer.nom || '').trim().split(/\s+/);
    const firstName = parts.shift() || customer.nom;
    const lastName = parts.join(' ') || undefined;

    const noteLines = [
      'DEMANDE DE DEVIS (prix à définir)',
      `Référence : ${quoteId}`,
      customer.entreprise ? `Entreprise : ${customer.entreprise}` : null,
      customer.telephone ? `Téléphone : ${customer.telephone}` : null,
      customer.message ? `Message : ${customer.message}` : null,
    ].filter(Boolean);

    return {
      line_items: [
        {
          title: coin.name,
          // Prix 0 : c'est un devis, le montant sera défini par l'équipe.
          price: '0.00',
          quantity: coin.qty,
          custom: true,
          properties: properties.length ? properties : undefined,
        },
      ],
      customer: {
        email: customer.email,
        first_name: firstName,
        last_name: lastName,
        phone: customer.telephone,
      },
      email: customer.email,
      note: noteLines.join('\n'),
      tags: 'devis, coins, configurateur',
    };
  }

  /** Envoie l'email équipe + accusé client sans bloquer la réponse HTTP. */
  private async sendEmailsBestEffort(
    clientEmail: string,
    emailData: QuoteEmailData,
  ): Promise<void> {
    try {
      await this.email.sendQuoteEmail(emailData);
    } catch (error) {
      this.logger.warn(`Email équipe non envoyé: ${(error as Error).message}`);
    }
    try {
      await this.email.sendQuoteAck(clientEmail, emailData);
    } catch (error) {
      this.logger.warn(`Accusé de réception non envoyé: ${(error as Error).message}`);
    }
  }

  /** Liste des devis stockes en memoire. */
  findAll(): StoredQuote[] {
    return Array.from(this.quotes.values());
  }
}
