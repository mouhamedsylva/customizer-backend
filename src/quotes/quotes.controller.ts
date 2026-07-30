import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { AdminSessionGuard } from '../admin/admin-session.guard';

@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  /**
   * POST /api/quotes — PUBLIC : le configurateur envoie les demandes de devis
   * depuis le thème, sans session (le visiteur n'est pas authentifié).
   */
  @Post()
  create(
    @Body() dto: CreateQuoteDto,
  ): Promise<{ success: boolean; quoteId: string }> {
    return this.quotesService.create(dto);
  }

  /**
   * GET /api/quotes — RÉSERVÉ AUX ADMINS.
   *
   * Renvoie les devis complets, dont `quoteData.customer` : nom, e-mail,
   * téléphone, entreprise. Cette route était publique : l'intégralité du
   * fichier prospects était lisible par quiconque connaissait l'URL.
   *
   * Aucun appelant côté thème (le configurateur ne fait que POST) : la
   * protection ne casse rien. Le dashboard passe par AdminService, pas par
   * cette route.
   */
  @UseGuards(AdminSessionGuard)
  @Get()
  findAll() {
    return this.quotesService.findAll();
  }
}
