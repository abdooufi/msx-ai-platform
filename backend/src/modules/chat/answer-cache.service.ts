import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import Redis from 'ioredis';

export interface CachedAnswer {
  text:     string;
  language: string;
  sources:  Array<{ title: string; url: string; content: string; score: number; type: string }>;
}

/**
 * Redis-backed cache for final chat answers.
 *
 * Only static answers are cached (chat.service skips caching whenever live
 * market data was injected or conversation history was used), so a short TTL
 * keeps repeated FAQ-style questions from hitting the LLM again.
 *
 * Disabled entirely when ANSWER_CACHE_TTL=0 or Redis is unreachable.
 */
@Injectable()
export class AnswerCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(AnswerCacheService.name);
  private redis: Redis | null = null;
  private readonly ttlSeconds: number;

  constructor(private config: ConfigService) {
    this.ttlSeconds = parseInt(config.get('ANSWER_CACHE_TTL', '600'), 10);
    if (this.ttlSeconds <= 0) {
      this.logger.log('Answer cache disabled (ANSWER_CACHE_TTL=0)');
      return;
    }
    const url = config.get<string>('REDIS_URL', 'redis://localhost:6379');
    try {
      this.redis = new Redis(url, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        retryStrategy: () => null, // fail fast — cache is best-effort
      });
      this.redis.on('error', () => { /* handled per-call */ });
    } catch {
      this.logger.warn('Redis init failed — answer caching disabled');
      this.redis = null;
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => {});
  }

  /** Normalize a question so trivial differences hit the same cache entry */
  private key(message: string, language: string): string {
    const norm = message.toLowerCase().trim()
      .replace(/[؟?!.،,]+$/gu, '')
      .replace(/\s+/g, ' ');
    const h = createHash('sha256').update(`${language}:${norm}`).digest('hex');
    return `answer_cache:${h}`;
  }

  async get(message: string, language: string): Promise<CachedAnswer | null> {
    if (!this.redis || this.ttlSeconds <= 0) return null;
    try {
      const raw = await this.redis.get(this.key(message, language));
      return raw ? (JSON.parse(raw) as CachedAnswer) : null;
    } catch {
      return null;
    }
  }

  async set(message: string, language: string, answer: CachedAnswer): Promise<void> {
    if (!this.redis || this.ttlSeconds <= 0) return;
    try {
      await this.redis.set(
        this.key(message, language),
        JSON.stringify(answer),
        'EX',
        this.ttlSeconds,
      );
    } catch { /* best-effort */ }
  }
}
