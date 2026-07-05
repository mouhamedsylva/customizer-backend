import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EmailService, QuoteEmailData } from '../shared/email.service';
import { CreateQuoteDto } from './dto/create-quote.dto';

export interface StoredQuote extends CreateQuoteDto {
  quoteId: string;
  createdAt: string;
}

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  // TODO: brancher une vraie base de donnees. Stockage en memoire pour l'instant.
  private readonly quotes = new Map<string, StoredQuote>();

  constructor(private readonly email: EmailService) {}

  /**
   * Cree une demande de devis : email a l'equipe + accuse de reception au client.
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

    // On enregistre TOUJOURS la demande, même si l'email échoue.
    this.quotes.set(quoteId, {
      ...dto,
      quoteId,
      createdAt: new Date().toISOString(),
    });

    // Envoi des emails APRÈS avoir répondu au client (setImmediate détache
    // complètement l'envoi de la requête HTTP courante).
    setImmediate(() => {
      void this.sendEmailsBestEffort(dto.customer.email, emailData);
    });

    return { success: true, quoteId };
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
