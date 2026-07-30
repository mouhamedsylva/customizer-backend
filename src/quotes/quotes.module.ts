import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { RemindersService } from './reminders.service';
import { SettingsModule } from '../admin/settings.module';
import { AdminModule } from '../admin/admin.module';
import { Quote } from '../database/entities/quote.entity';

@Module({
  /* AdminModule fournit AdminSessionGuard, qui protège GET /api/quotes
     (données personnelles). Pas de cycle : AdminModule n'importe pas ce
     module. */
  imports: [TypeOrmModule.forFeature([Quote]), SettingsModule, AdminModule],
  controllers: [QuotesController],
  providers: [QuotesService, RemindersService],
  exports: [QuotesService],
})
export class QuotesModule {}
