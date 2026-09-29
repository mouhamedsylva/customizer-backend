import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { UploadsController } from './uploads.controller';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    // Stockage en memoire : les buffers sont passes directement a sharp/Cloudinary.
    MulterModule.register({
      storage: undefined,
      // 15 Mo : garde-fou côté multer, en amont du contrôle métier (assertFile).
      // Ces endpoints sont publics (upload depuis le configurateur) : sans borne,
      // un POST de plusieurs centaines de Mo saturerait la mémoire du conteneur.
      limits: { fileSize: 15 * 1024 * 1024, files: 1 },
      /* Pas de filtre de type ICI : posé sur le module, il s'appliquait à
         TOUTES les routes et refusait les PDF / DOCX des pièces jointes.
         Chaque route déclare le sien (type-fichier.ts). */
    }),
    /* AdminModule fournit AdminSessionGuard, qui protège la suppression
       d'images. Pas de cycle : AdminModule n'importe pas ce module. */
    AdminModule,
  ],
  controllers: [UploadsController],
})
export class UploadsModule {}
