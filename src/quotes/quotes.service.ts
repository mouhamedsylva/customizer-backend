import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
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

    try {
      // Envoi a l'equipe (obligatoire) puis accuse client (best-effort).
      await this.email.sendQuoteEmail(emailData);
      try {
        await this.email.sendQuoteAck(dto.customer.email, emailData);
      } catch (ackError) {
        this.logger.warn(`Accuse de reception non envoye: ${(ackError as Error).message}`);
      }
    } catch (error) {
      this.logger.error(`Echec envoi devis: ${(error as Error).message}`);
      throw new HttpException(
        `Impossible d'envoyer la demande de devis: ${(error as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    this.quotes.set(quoteId, {
      ...dto,
      quoteId,
      createdAt: new Date().toISOString(),
    });

    return { success: true, quoteId };
  }

  /** Liste des devis stockes en memoire. */
  findAll(): StoredQuote[] {
    return Array.from(this.quotes.values());
  }
}
