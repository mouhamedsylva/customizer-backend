import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Prefixe global de toutes les routes : /api/...
  app.setGlobalPrefix('api');

  // CORS : autorise le frontend configuré (FRONTEND_URL) + variantes utiles.
  // En développement, on accepte aussi le domaine Shopify et localhost.
  const frontendUrl =
    config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
  const allowedOrigins = [
    frontendUrl,
    frontendUrl.replace(/^https?:\/\//, 'https://'),
    'http://localhost:9292',    // shopify theme dev
    'http://127.0.0.1:9292',
  ];
  app.enableCors({
    origin: (origin, callback) => {
      // Autorise les requêtes sans origin (Postman, curl) et les origines listées.
      if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.myshopify.com')) {
        callback(null, true);
      } else {
        callback(null, true); // en dev, on reste permissif ; à durcir en prod.
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
  });

  // Validation automatique des DTOs (class-validator) sur toutes les routes.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const port = parseInt(config.get<string>('PORT') || '3000', 10);
  await app.listen(port);

  Logger.log(`Customizer backend demarre sur http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
