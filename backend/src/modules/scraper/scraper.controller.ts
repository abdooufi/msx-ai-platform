import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/guards/roles.decorator';
import { ScraperService } from './scraper.service';

@ApiTags('Scraper')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
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

  @Post('schedule')
  @ApiOperation({ summary: 'Schedule daily auto-recrawl' })
  async schedule() {
    await this.scraper.scheduleRecrawl();
    return { ok: true, message: 'Recrawl scheduled' };
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
}
