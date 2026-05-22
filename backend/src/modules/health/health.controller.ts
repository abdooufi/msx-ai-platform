import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import axios from 'axios';
import { AppPgService } from '../database/app-pg.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly pg: AppPgService,
    private readonly config: ConfigService,
    @InjectQueue('scraper') private readonly scraperQueue: Queue,
  ) {}

  /** GET /api/health — liveness probe (fast, no deps) */
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'msx-ai-backend',
      version: process.env.npm_package_version || '1.0.0',
    };
  }

  /** GET /api/health/ready — readiness probe (checks all dependencies) */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks DB, Qdrant, Redis' })
  async readiness() {
    const start = Date.now();
    const checks = await Promise.allSettled([
      this.checkPostgres(),
      this.checkQdrant(),
      this.checkRedis(),
      this.checkOllama(),
    ]);

    const [pg, qdrant, redis, ollama] = checks.map((r, i) => {
      const name = ['postgres', 'qdrant', 'redis', 'ollama'][i];
      if (r.status === 'fulfilled') return { name, ...r.value };
      return { name, status: 'down', error: String(r.reason) };
    });

    const allUp = [pg, qdrant, redis].every((c: any) => c.status === 'up');

    return {
      status: allUp ? 'ok' : 'degraded',
      latencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
      checks: { pg, qdrant, redis, ollama },
    };
  }

  private async checkPostgres(): Promise<{ status: string; latencyMs?: number }> {
    const t = Date.now();
    try {
      await this.pg.query('SELECT 1');
      return { status: 'up', latencyMs: Date.now() - t };
    } catch (e) {
      return { status: 'down', latencyMs: Date.now() - t };
    }
  }

  private async checkQdrant(): Promise<{ status: string; latencyMs?: number }> {
    const t   = Date.now();
    const url = this.config.get('QDRANT_URL', 'http://qdrant:6333');
    try {
      await axios.get(`${url}/readyz`, { timeout: 3_000 });
      return { status: 'up', latencyMs: Date.now() - t };
    } catch {
      return { status: 'down', latencyMs: Date.now() - t };
    }
  }

  private async checkRedis(): Promise<{ status: string; latencyMs?: number }> {
    const t = Date.now();
    try {
      await this.scraperQueue.client.ping();
      return { status: 'up', latencyMs: Date.now() - t };
    } catch {
      return { status: 'down', latencyMs: Date.now() - t };
    }
  }

  private async checkOllama(): Promise<{ status: string; latencyMs?: number }> {
    const t   = Date.now();
    const url = this.config.get('OLLAMA_URL', 'http://ollama:11434');
    try {
      await axios.get(`${url}/api/tags`, { timeout: 3_000 });
      return { status: 'up', latencyMs: Date.now() - t };
    } catch {
      return { status: 'down', latencyMs: Date.now() - t };
    }
  }
}
