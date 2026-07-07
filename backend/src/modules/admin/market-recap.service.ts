import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagService } from '../rag/rag.service';
import { DynamicApiService } from './dynamic-api.service';
import { ChatbootPgService } from './chatboot-pg.service';
import { KnowledgeType } from '../../schemas/knowledge.schema';

/**
 * Daily market recap — once per trading day (Sun–Thu), after market close,
 * fetches all market-level dynamic API endpoints (those whose URL template
 * does not need a {symbol}) and indexes a dated summary into the knowledge
 * base. This makes questions like "how did the market do yesterday?" answerable.
 *
 * Config:
 *   MARKET_RECAP_ENABLED   default true
 *   MARKET_RECAP_TIME_UTC  default '10:30'  (= 14:30 Oman, after 13:00 close)
 *   MARKET_RECAP_KEEP_DAYS default 14       (older recaps are deleted)
 *
 * Last-run date is stored in system_settings so restarts don't double-run.
 */
@Injectable()
export class MarketRecapService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketRecapService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private config:     ConfigService,
    private rag:        RagService,
    private dynamicApi: DynamicApiService,
    private chatPg:     ChatbootPgService,
  ) {}

  onModuleInit() {
    if (this.config.get('MARKET_RECAP_ENABLED', 'true') === 'false') {
      this.logger.log('Market recap disabled (MARKET_RECAP_ENABLED=false)');
      return;
    }
    // Check every 5 minutes whether the scheduled time has passed today
    this.timer = setInterval(() => void this.tick(), 5 * 60_000);
    this.logger.log(`📈 Market recap scheduled daily at ${this.timeUtc()} UTC (Sun–Thu)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private timeUtc(): string {
    return this.config.get('MARKET_RECAP_TIME_UTC', '10:30');
  }

  getStatus() {
    return {
      enabled: this.config.get('MARKET_RECAP_ENABLED', 'true') !== 'false',
      timeUtc: this.timeUtc(),
      keepDays: parseInt(this.config.get('MARKET_RECAP_KEEP_DAYS', '14'), 10),
    };
  }

  private async tick(): Promise<void> {
    try {
      const now = new Date();
      const day = now.getUTCDay(); // 0=Sun … 6=Sat; MSX trades Sun(0)–Thu(4)
      if (day === 5 || day === 6) return;

      const [h, m] = this.timeUtc().split(':').map(Number);
      if (now.getUTCHours() < h || (now.getUTCHours() === h && now.getUTCMinutes() < m)) return;

      const today = now.toISOString().slice(0, 10);
      const lastRun = await this.chatPg.getSetting('market_recap_last_date').catch(() => null);
      if (lastRun === today) return;

      await this.runNow();
    } catch (err) {
      this.logger.error(`Market recap tick failed: ${err.message}`);
    }
  }

  /** Build + index today's recap. Also callable manually from the admin API. */
  async runNow(): Promise<{ date: string; endpointsUsed: number; chunksIndexed: number }> {
    const date = new Date().toISOString().slice(0, 10);

    // Market-level endpoints = active endpoints whose template needs no {symbol}
    const all = await this.chatPg.getActiveApiEndpoints();
    const marketEndpoints = all.filter(ep => {
      const tpl = JSON.stringify(ep.url_template ?? ep.url ?? '') + JSON.stringify(ep.body_template ?? '');
      return !tpl.includes('{symbol}');
    });

    const sections: string[] = [];
    for (const ep of marketEndpoints) {
      try {
        const data = await this.dynamicApi.callEndpoint(ep, '');
        if (!data) continue;
        const lines = this.dynamicApi.flattenAny(data).slice(0, 40);
        if (lines.length) {
          sections.push(`## ${ep.name || ep.category || 'Market data'}\n${lines.join('\n')}`);
        }
      } catch (err) {
        this.logger.warn(`Recap endpoint "${ep.name}" failed: ${err.message}`);
      }
    }

    if (!sections.length) {
      this.logger.warn('Market recap: no market-level endpoint returned data — nothing indexed');
      await this.chatPg.upsertSystemSetting('market_recap_last_date', date).catch(() => {});
      return { date, endpointsUsed: 0, chunksIndexed: 0 };
    }

    const content =
      `MSX / Muscat Stock Exchange market recap for ${date} (ملخص سوق مسقط ليوم ${date}).\n\n` +
      sections.join('\n\n');

    const chunksIndexed = await this.rag.indexContent({
      title:    `MSX Market Recap — ${date}`,
      content:  content.slice(0, 20_000),
      sourceId: `recap:${date}`,
      type:     KnowledgeType.MANUAL,
      language: 'en',
      tags:     ['market-recap', date],
      metadata: { recapDate: date },
    });

    // Retention: delete the recap that just fell out of the window
    const keepDays = parseInt(this.config.get('MARKET_RECAP_KEEP_DAYS', '14'), 10);
    const expired = new Date(Date.now() - (keepDays + 1) * 24 * 3600_000).toISOString().slice(0, 10);
    await this.rag.deleteSource(`recap:${expired}`).catch(() => {});

    await this.chatPg.upsertSystemSetting('market_recap_last_date', date).catch(() => {});
    this.logger.log(`📈 Market recap indexed for ${date}: ${marketEndpoints.length} endpoints → ${chunksIndexed} chunks`);
    return { date, endpointsUsed: marketEndpoints.length, chunksIndexed };
  }
}
