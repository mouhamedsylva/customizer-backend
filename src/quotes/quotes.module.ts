import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { RemindersService } from './reminders.service';
import { SettingsModule } from '../admin/settings.module';
import { Quote } from '../database/entities/quote.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Quote]), SettingsModule],
  controllers: [QuotesController],
  providers: [QuotesService, RemindersService],
  exports: [QuotesService],
})
export class QuotesModule {}
