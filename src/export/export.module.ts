import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { Design } from '../database/entities/design.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Design])],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
