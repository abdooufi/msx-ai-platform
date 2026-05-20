import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import compression from 'compression';
import { join } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // ─── Security ──────────────────────────────────────────────────
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());

  // ─── CORS ──────────────────────────────────────────────────────
  app.enableCors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ─── Global pipes / filters / interceptors ─────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // ─── Static file uploads ────────────────────────────────────────
  app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads' });

  // ─── API prefix ────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ─── Swagger docs ───────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('MSX AI Platform API')
      .setDescription('Production-ready AI chatbot for Muscat Stock Exchange')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
    logger.log('Swagger docs available at /docs');
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`🚀 MSX AI Backend running on port ${port}`);
}

bootstrap();
