import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { SCRAPER_QUEUE, CrawlJobType } from './scraper.constants';
import { ChatbootPgService } from '../admin/chatboot-pg.service';

const SITEMAP_URL  = 'https://www.msx.om/sitemap.aspx';
const MSX_BASE     = 'https://www.msx.om';
const MAX_SITEMAP_URLS = 2000;

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  constructor(
    @InjectQueue(SCRAPER_QUEUE) private scraperQueue: Queue,
    private config: ConfigService,
    private pg: ChatbootPgService,
  ) {}

  // ─── Existing single-URL crawl ────────────────────────────────────────────

  /** Enqueue a full recursive site crawl */
  async startSiteCrawl(url?: string): Promise<{ jobId: string | number }> {
    const targetUrl = url || this.config.get<string>('SCRAPER_TARGET_URL', MSX_BASE);
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

  // ─── Sitemap crawl ────────────────────────────────────────────────────────

  /**
   * Fetch https://www.msx.om/sitemap.aspx, extract every URL from it
   * (handles both XML <loc> tags and plain HTML links), then enqueue
   * a CRAWL_PAGE job for each one.
   */
  async startSitemapCrawl(): Promise<{ queued: number; urls: string[] }> {
    this.logger.log(`🗺️ Fetching sitemap: ${SITEMAP_URL}`);
    const urls = await this.parseSitemap(SITEMAP_URL);

    const jobs = await Promise.all(
      urls.map(url =>
        this.scraperQueue.add(
          CrawlJobType.CRAWL_PAGE,
          { url },
          { priority: 4, attempts: 2 },
        ),
      ),
    );

    this.logger.log(`🗺️ Sitemap: queued ${jobs.length} page jobs`);
    return { queued: jobs.length, urls };
  }

  /**
   * Parse a sitemap URL and return all page URLs found.
   * Handles:  XML sitemaps (<loc> tags) · sitemap-index (<sitemap><loc>) ·
   *           HTML pages (href links on the same domain).
   */
  async parseSitemap(sitemapUrl: string): Promise<string[]> {
    let html: string;
    try {
      const { data } = await axios.get(sitemapUrl, {
        timeout: 20_000,
        headers: {
          'User-Agent': 'MSXBot/1.0 (+https://www.msx.om/bot)',
          Accept: 'text/html,application/xml,application/xhtml+xml,*/*',
        },
        responseType: 'text',
      });
      html = typeof data === 'string' ? data : JSON.stringify(data);
    } catch (err: any) {
      this.logger.warn(`Failed to fetch sitemap ${sitemapUrl}: ${err.message}`);
      return [];
    }

    const urls: string[] = [];

    // 1. XML sitemap: look for <loc>…</loc>
    if (html.includes('<loc>') || html.includes('<?xml')) {
      for (const m of html.matchAll(/<loc>\s*(https?[^<\s]+)\s*<\/loc>/g)) {
        const u = m[1].trim();
        if (u.startsWith(MSX_BASE)) urls.push(u);
      }
      // Recurse into sitemap-index nested sitemaps
      const nested: string[] = [];
      for (const m of html.matchAll(/<sitemap>[\s\S]*?<loc>\s*(https?[^<\s]+)\s*<\/loc>/g)) {
        nested.push(m[1].trim());
      }
      for (const nsUrl of nested) {
        const sub = await this.parseSitemap(nsUrl);
        urls.push(...sub);
      }
      if (urls.length) {
        return [...new Set(this.filterUrls(urls))].slice(0, MAX_SITEMAP_URLS);
      }
    }

    // 2. HTML: extract same-domain anchor links
    const $ = cheerio.load(html);
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      try {
        const resolved = new URL(href, MSX_BASE);
        if (resolved.hostname === 'www.msx.om') {
          urls.push(resolved.origin + resolved.pathname);
        }
      } catch { /* invalid URL */ }
    });

    return [...new Set(this.filterUrls(urls))].slice(0, MAX_SITEMAP_URLS);
  }

  private filterUrls(urls: string[]): string[] {
    return urls.filter(
      u => u && !u.match(/\.(jpg|jpeg|png|gif|svg|ico|css|js|zip|pdf|doc|xls)$/i),
    );
  }

  // ─── Company URL crawl ───────────────────────────────────────────────────

  /**
   * Fetch all company URLs from the `companies` table (where url IS NOT NULL)
   * and enqueue a CRAWL_PAGE job for each one.
   */
  async startCompanyCrawl(): Promise<{ queued: number; companies: { symbol: string; url: string }[] }> {
    const companies = await this.pg.getCompanyUrlsForCrawl();

    if (!companies.length) {
      this.logger.warn('Company crawl: no URLs found in companies table');
      return { queued: 0, companies: [] };
    }

    await Promise.all(
      companies.map(c =>
        this.scraperQueue.add(
          CrawlJobType.CRAWL_PAGE,
          { url: c.url, companySymbol: c.symbol },
          { priority: 4, attempts: 2 },
        ),
      ),
    );

    this.logger.log(`🏢 Company crawl: queued ${companies.length} company page jobs`);
    return { queued: companies.length, companies };
  }

  // ─── "Crawl Everything" ───────────────────────────────────────────────────

  /**
   * Trigger all three crawl sources at once:
   *   1. Sitemap    — all URLs from sitemap.aspx
   *   2. Companies  — all URLs from companies table
   *   3. Site crawl — recursive general crawl from MSX_BASE
   */
  async startAllCrawl(customUrl?: string): Promise<{
    sitemap:   { queued: number; urls: string[] };
    companies: { queued: number; companies: { symbol: string; url: string }[] };
    site:      { jobId: string | number };
  }> {
    const [sitemapResult, companyResult, siteResult] = await Promise.all([
      this.startSitemapCrawl().catch(err => {
        this.logger.error(`Sitemap crawl failed: ${err.message}`);
        return { queued: 0, urls: [] as string[] };
      }),
      this.startCompanyCrawl().catch(err => {
        this.logger.error(`Company crawl failed: ${err.message}`);
        return { queued: 0, companies: [] as { symbol: string; url: string }[] };
      }),
      this.startSiteCrawl(customUrl),
    ]);

    this.logger.log(
      `🚀 All-sources crawl queued — sitemap: ${sitemapResult.queued}, ` +
      `companies: ${companyResult.queued}, site: 1`,
    );
    return { sitemap: sitemapResult, companies: companyResult, site: siteResult };
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  async getQueueStats() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.scraperQueue.getWaitingCount(),
      this.scraperQueue.getActiveCount(),
      this.scraperQueue.getCompletedCount(),
      this.scraperQueue.getFailedCount(),
    ]);
    const companyUrlCount = await this.pg.getCompanyUrlsForCrawl()
      .then(r => r.length)
      .catch(() => 0);
    return { waiting, active, completed, failed, companyUrlCount };
  }

  // ─── Scheduled recrawl ────────────────────────────────────────────────────

  private readonly SCHEDULE_JOB_ID = 'recrawl-msx';

  /** Get current repeatable schedule info, or null if none is active */
  async getScheduleInfo(): Promise<{
    active: boolean;
    cron?: string;
    nextRunAt?: string;
    key?: string;
  }> {
    try {
      const jobs = await this.scraperQueue.getRepeatableJobs();
      const job  = jobs.find(j => j.id === this.SCHEDULE_JOB_ID || j.name === CrawlJobType.RECRAWL);
      if (!job) return { active: false };
      return {
        active:    true,
        cron:      job.cron,
        nextRunAt: job.next ? new Date(job.next).toISOString() : undefined,
        key:       job.key,
      };
    } catch {
      return { active: false };
    }
  }

  /** Remove any existing schedule */
  async cancelSchedule(): Promise<void> {
    const jobs = await this.scraperQueue.getRepeatableJobs().catch(() => []);
    for (const job of jobs) {
      if (job.id === this.SCHEDULE_JOB_ID || job.name === CrawlJobType.RECRAWL) {
        await this.scraperQueue.removeRepeatableByKey(job.key).catch(() => {});
        this.logger.log(`⏰ Recrawl schedule cancelled (key: ${job.key})`);
      }
    }
  }

  /**
   * Set (or replace) the auto-recrawl schedule.
   * @param cron  Standard 5-field cron expression, e.g. "0 2 * * *" (daily at 2 am)
   */
  async setSchedule(cron: string): Promise<{ active: boolean; cron: string; nextRunAt?: string }> {
    await this.cancelSchedule();

    const targetUrl = this.config.get<string>('SCRAPER_TARGET_URL', MSX_BASE);
    await this.scraperQueue.add(
      CrawlJobType.RECRAWL,
      { url: targetUrl },
      {
        repeat: { cron },
        jobId:  this.SCHEDULE_JOB_ID,
      },
    );
    this.logger.log(`⏰ Recrawl schedule set: "${cron}"`);

    // Return fresh info so the caller can confirm next run time
    const info = await this.getScheduleInfo();
    return { active: true, cron, nextRunAt: info.nextRunAt };
  }

  /** Legacy helper kept for backward compat (called by old controller action) */
  async scheduleRecrawl(): Promise<void> {
    const hours = parseInt(this.config.get('SCRAPER_RECRAWL_HOURS', '24'), 10);
    await this.setSchedule(`0 */${hours} * * *`);
  }

  // ─── Qdrant snapshot schedule ─────────────────────────────────────────────

  private readonly SNAPSHOT_JOB_ID = 'qdrant-snapshot';

  async getSnapshotScheduleInfo(): Promise<{ active: boolean; cron?: string; nextRunAt?: string }> {
    try {
      const jobs = await this.scraperQueue.getRepeatableJobs();
      const job  = jobs.find(j => j.id === this.SNAPSHOT_JOB_ID || j.name === CrawlJobType.QDRANT_SNAPSHOT);
      if (!job) return { active: false };
      return {
        active:    true,
        cron:      job.cron,
        nextRunAt: job.next ? new Date(job.next).toISOString() : undefined,
      };
    } catch {
      return { active: false };
    }
  }

  async cancelSnapshotSchedule(): Promise<void> {
    const jobs = await this.scraperQueue.getRepeatableJobs().catch(() => []);
    for (const job of jobs) {
      if (job.id === this.SNAPSHOT_JOB_ID || job.name === CrawlJobType.QDRANT_SNAPSHOT) {
        await this.scraperQueue.removeRepeatableByKey(job.key).catch(() => {});
        this.logger.log(`Qdrant snapshot schedule cancelled`);
      }
    }
  }

  async setSnapshotSchedule(cron: string): Promise<{ active: boolean; cron: string; nextRunAt?: string }> {
    await this.cancelSnapshotSchedule();
    await this.scraperQueue.add(
      CrawlJobType.QDRANT_SNAPSHOT,
      {},
      { repeat: { cron }, jobId: this.SNAPSHOT_JOB_ID },
    );
    this.logger.log(`Qdrant snapshot schedule set: "${cron}"`);
    const info = await this.getSnapshotScheduleInfo();
    return { active: true, cron, nextRunAt: info.nextRunAt };
  }
}
