import { Body, Controller, Get, Post } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { CreateQuoteDto } from './dto/create-quote.dto';

@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  /** POST /api/quotes */
  @Post()
  create(
    @Body() dto: CreateQuoteDto,
  ): Promise<{ success: boolean; quoteId: string }> {
    return this.quotesService.create(dto);
  }

  /** GET /api/quotes */
  @Get()
  findAll() {
    return this.quotesService.findAll();
  }
}
