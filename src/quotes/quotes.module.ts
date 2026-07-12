import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { Quote } from '../database/entities/quote.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Quote])],
  controllers: [QuotesController],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
