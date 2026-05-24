import { Controller, Post, Get, Delete, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/guards/roles.decorator';
import { ScraperService } from './scraper.service';

@ApiTags('Scraper')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'editor', 'agent')
@Controller('train/website')
export class ScraperController {
  constructor(private readonly scraper: ScraperService) {}

  // ── Existing endpoints ──────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Start recursive site crawl from a root URL' })
  async startCrawl(@Body() body: { url?: string }) {
    return this.scraper.startSiteCrawl(body?.url);
  }

  @Post('page')
  @ApiOperation({ summary: 'Crawl a single page and index its content' })
  async crawlPage(@Body() body: { url: string }) {
    return this.scraper.crawlPage(body.url);
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Get current auto-recrawl schedule' })
  async getSchedule() {
    return this.scraper.getScheduleInfo();
  }

  @Post('schedule')
  @ApiOperation({ summary: 'Set (or replace) the auto-recrawl cron schedule' })
  @ApiBody({ schema: { properties: { cron: { type: 'string', example: '0 2 * * *' } } } })
  async setSchedule(@Body() body: { cron: string }) {
    if (!body?.cron) {
      // No cron provided — fall back to legacy env-var schedule
      await this.scraper.scheduleRecrawl();
      return this.scraper.getScheduleInfo();
    }
    return this.scraper.setSchedule(body.cron);
  }

  @Delete('schedule')
  @ApiOperation({ summary: 'Cancel the auto-recrawl schedule' })
  async cancelSchedule() {
    await this.scraper.cancelSchedule();
    return { active: false };
  }

  @Get('status')
  @ApiOperation({ summary: 'Queue stats + company URL count' })
  async status() {
    return this.scraper.getQueueStats();
  }

  // ── New: sitemap crawl ──────────────────────────────────────────────────

  @Post('sitemap')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Parse https://www.msx.om/sitemap.aspx and enqueue every URL for indexing',
  })
  async crawlSitemap() {
    return this.scraper.startSitemapCrawl();
  }

  // ── New: company pages crawl ────────────────────────────────────────────

  @Post('companies')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Enqueue a CRAWL_PAGE job for every company URL stored in the companies table',
  })
  async crawlCompanies() {
    return this.scraper.startCompanyCrawl();
  }

  // ── New: crawl all sources at once ──────────────────────────────────────

  @Post('all')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Trigger all crawl sources simultaneously: sitemap + company pages + site crawl',
  })
  @ApiBody({ schema: { properties: { url: { type: 'string', description: 'Optional root URL override' } } } })
  async crawlAll(@Body() body: { url?: string }) {
    return this.scraper.startAllCrawl(body?.url);
  }

  // ── Qdrant snapshot schedule ────────────────────────────────────────────

  @Get('snapshot-schedule')
  @ApiOperation({ summary: 'Get current Qdrant snapshot schedule' })
  async getSnapshotSchedule() {
    return this.scraper.getSnapshotScheduleInfo();
  }

  @Post('snapshot-schedule')
  @ApiOperation({ summary: 'Set (or replace) the Qdrant auto-snapshot cron schedule' })
  @ApiBody({ schema: { properties: { cron: { type: 'string', example: '0 3 * * *' } } } })
  async setSnapshotSchedule(@Body() body: { cron: string }) {
    if (!body?.cron) throw new Error('cron expression required');
    return this.scraper.setSnapshotSchedule(body.cron);
  }

  @Delete('snapshot-schedule')
  @ApiOperation({ summary: 'Cancel the Qdrant snapshot schedule' })
  async cancelSnapshotSchedule() {
    await this.scraper.cancelSnapshotSchedule();
    return { active: false };
  }
}
