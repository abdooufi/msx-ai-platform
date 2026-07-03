import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { RagModule } from './modules/rag/rag.module';
import { ScraperModule } from './modules/scraper/scraper.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { DatabaseModule } from './modules/database/database.module';
import { HealthController } from './modules/health/health.controller';
import { AppPgService } from './modules/database/app-pg.service';
import { appConfig } from './config/app.config';

@Module({
  controllers: [HealthController],
  providers:   [AppPgService],
  imports: [
    // ─── Config ───────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env', '.env.local'],
    }),

    // ─── PostgreSQL (app tables) ──────────────────────────────
    DatabaseModule,

    // ─── Rate limiting ────────────────────────────────────────
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        throttlers: [{
          ttl: cs.get<number>('RATE_LIMIT_TTL', 60) * 1000,
          limit: cs.get<number>('RATE_LIMIT_MAX', 30),
        }],
      }),
    }),

    // ─── Redis / BullMQ ───────────────────────────────────────
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        redis: cs.get<string>('REDIS_URL'),
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      }),
    }),

    // ─── Health check queue access ────────────────────────────
    BullModule.registerQueue({ name: 'scraper' }),

    // ─── Feature modules ──────────────────────────────────────
    AuthModule,
    ChatModule,
    ChannelsModule,
    RagModule,
    ScraperModule,
    DocumentsModule,
    AnalyticsModule,
    AdminModule,
    AuditModule,
  ],
})
export class AppModule {}
