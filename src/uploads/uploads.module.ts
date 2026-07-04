import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { UploadsController } from './uploads.controller';

@Module({
  imports: [
    // Stockage en memoire : les buffers sont passes directement a sharp/Cloudinary.
    MulterModule.register({
      storage: undefined,
    }),
  ],
  controllers: [UploadsController],
})
export class UploadsModule {}
