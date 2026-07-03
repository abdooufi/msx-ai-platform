import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import * as compression from 'compression';
import { join } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const isDev  = process.env.NODE_ENV !== 'production';

  // ── Startup env validation ─────────────────────────────────────
  const requiredVars = ['JWT_SECRET'];
  const missing = requiredVars.filter(k => !process.env[k]);
  if (missing.length) {
    logger.error(`Missing required env vars: ${missing.join(', ')} — exiting`);
    process.exit(1);
  }
  if (!isDev && process.env.JWT_SECRET === 'dev-secret') {
    logger.error('JWT_SECRET must not be "dev-secret" in production — exiting');
    process.exit(1);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: isDev
      ? ['error', 'warn', 'log', 'debug', 'verbose']
      : ['error', 'warn', 'log'],
  });

  // ── Graceful shutdown (drains Bull queues + PG pool on SIGTERM) ─
  app.enableShutdownHooks();

  // ── Security headers ───────────────────────────────────────────
  // CSP stays off in dev (breaks Swagger UI); enabled in production.
  app.use(helmet({ contentSecurityPolicy: isDev ? false : undefined }));
  app.use(compression());

  // ── CORS ───────────────────────────────────────────────────────
  // Dev: allow all origins. Production: restrict to FRONTEND_URL.
  const corsOrigin = isDev ? true : (process.env.FRONTEND_URL || false);
  if (!isDev && !process.env.FRONTEND_URL) {
    logger.warn('FRONTEND_URL not set — CORS will block all cross-origin requests');
  }
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ── Global pipes / filters / interceptors ─────────────────────
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

  // ── Static file uploads ────────────────────────────────────────
  app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads' });

  // ── API prefix ─────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Swagger docs (dev only) ────────────────────────────────────
  if (isDev) {
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
  logger.log(`MSX AI Backend running on port ${port}`);
}

bootstrap();
