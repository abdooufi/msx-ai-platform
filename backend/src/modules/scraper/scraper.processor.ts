import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { RagService } from '../rag/rag.service';
import { KnowledgeType } from '../../schemas/knowledge.schema';
import { SCRAPER_QUEUE, CrawlJobType } from './scraper.constants';

@Processor(SCRAPER_QUEUE)
export class ScraperProcessor {
  private readonly logger = new Logger(ScraperProcessor.name);
  private visited = new Set<string>();

  constructor(
    private rag: RagService,
    private config: ConfigService,
  ) {}

  @Process(CrawlJobType.CRAWL_SITE)
  async crawlSite(job: Job<{ url: string; depth: number; maxDepth: number }>) {
    const { url, depth, maxDepth } = job.data;
    this.visited.clear();
    await this.crawlRecursive(url, depth, maxDepth, job);
    this.logger.log(`✅ Site crawl complete. Pages visited: ${this.visited.size}`);
  }

  @Process(CrawlJobType.CRAWL_PAGE)
  async crawlSinglePage(job: Job<{ url: string }>) {
    await this.processPage(job.data.url);
  }

  @Process(CrawlJobType.RECRAWL)
  async recrawl(job: Job<{ url: string }>) {
    this.logger.log('🔄 Starting scheduled recrawl...');
    this.visited.clear();
    await this.crawlRecursive(job.data.url, 0, 3, job);
    this.logger.log(`✅ Recrawl complete. Pages visited: ${this.visited.size}`);
  }

  private async crawlRecursive(
    url: string,
    depth: number,
    maxDepth: number,
    job: Job,
  ): Promise<void> {
    const maxPages = this.config.get<number>('SCRAPER_MAX_PAGES', 500);

    if (
      this.visited.has(url) ||
      this.visited.size >= maxPages ||
      depth > maxDepth
    ) return;

    this.visited.add(url);
    await job.progress(Math.round((this.visited.size / maxPages) * 100));

    const links = await this.processPage(url);
    const delay = this.config.get<number>('SCRAPER_DELAY_MS', 1000);
    await new Promise(r => setTimeout(r, delay));

    // Recursively crawl discovered links
    const concurrency = this.config.get<number>('SCRAPER_CONCURRENCY', 3);
    for (let i = 0; i < links.length; i += concurrency) {
      const batch = links.slice(i, i + concurrency);
      await Promise.all(
        batch.map(link => this.crawlRecursive(link, depth + 1, maxDepth, job)),
      );
    }
  }

  private async processPage(url: string): Promise<string[]> {
    try {
      const { data: html } = await axios.get(url, {
        timeout: 15_000,
        headers: {
          'User-Agent': 'MSXBot/1.0 (+https://www.msx.om/bot)',
          Accept: 'text/html',
        },
      });

      const $ = cheerio.load(html);

      // Remove noise
      $('script, style, nav, footer, header, .advertisement, .cookie-banner').remove();

      const title = $('title').text().trim() || $('h1').first().text().trim() || url;
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

      if (bodyText.length < 100) {
        this.logger.debug(`Skipping thin page: ${url}`);
        return this.extractLinks($, url);
      }

      // Detect language
      const langAttr = $('html').attr('lang') || '';
      const language = langAttr.includes('ar') ? 'ar' : 'en';

      // Index into RAG
      await this.rag.indexContent({
        title,
        content: bodyText,
        sourceId: url,
        type: KnowledgeType.WEBSITE,
        url,
        language,
        metadata: {
          crawledAt: new Date().toISOString(),
          htmlLength: html.length,
        },
      });

      this.logger.debug(`✅ Indexed: ${title} (${url})`);
      return this.extractLinks($, url);
    } catch (err) {
      this.logger.warn(`Failed to crawl ${url}: ${err.message}`);
      return [];
    }
  }

  private extractLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
    const base = new URL(baseUrl);
    const links: string[] = [];

    $('a[href]').each((_, el) => {
      try {
        const href = $(el).attr('href') || '';
        const resolved = new URL(href, baseUrl);
        // Only follow same-domain links
        if (resolved.hostname === base.hostname) {
          const clean = resolved.origin + resolved.pathname;
          if (!this.visited.has(clean) && !clean.match(/\.(pdf|jpg|png|css|js|zip)$/i)) {
            links.push(clean);
          }
        }
      } catch { /* invalid URL */ }
    });

    return [...new Set(links)];
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} (${job.name}) failed: ${err.message}`);
  }
}
