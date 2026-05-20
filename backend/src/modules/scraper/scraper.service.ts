import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { SCRAPER_QUEUE, CrawlJobType } from './scraper.constants';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  constructor(
    @InjectQueue(SCRAPER_QUEUE) private scraperQueue: Queue,
    private config: ConfigService,
  ) {}

  /** Enqueue a full site crawl */
  async startSiteCrawl(url?: string): Promise<{ jobId: string | number }> {
    const targetUrl = url || this.config.get<string>('SCRAPER_TARGET_URL', 'https://www.msx.om');
    const job = await this.scraperQueue.add(
      CrawlJobType.CRAWL_SITE,
      { url: targetUrl, depth: 0, maxDepth: 3 },
      { priority: 5 },
    );
    this.logger.log(`🕷️ Started site crawl: ${targetUrl} (job ${job.id})`);
    return { jobId: job.id };
  }

  /** Enqueue a single page crawl */
  async crawlPage(url: string): Promise<{ jobId: string | number }> {
    const job = await this.scraperQueue.add(
      CrawlJobType.CRAWL_PAGE,
      { url },
      { priority: 3 },
    );
    return { jobId: job.id };
  }

  /** Schedule daily recrawl */
  async scheduleRecrawl(): Promise<void> {
    const hours = this.config.get<number>('SCRAPER_RECRAWL_HOURS', 24);
    const targetUrl = this.config.get<string>('SCRAPER_TARGET_URL', 'https://www.msx.om');

    await this.scraperQueue.add(
      CrawlJobType.RECRAWL,
      { url: targetUrl },
      {
        repeat: { cron: `0 */${hours} * * *` },
        jobId: 'recrawl-msx',
      },
    );
    this.logger.log(`⏰ Scheduled recrawl every ${hours} hours`);
  }

  async getQueueStats() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.scraperQueue.getWaitingCount(),
      this.scraperQueue.getActiveCount(),
      this.scraperQueue.getCompletedCount(),
      this.scraperQueue.getFailedCount(),
    ]);
    return { waiting, active, completed, failed };
  }
}
