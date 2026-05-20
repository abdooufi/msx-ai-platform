import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
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

  @Post()
  async startCrawl(@Body() body: { url?: string }) {
    return this.scraper.startSiteCrawl(body?.url);
  }

  @Post('page')
  async crawlPage(@Body() body: { url: string }) {
    return this.scraper.crawlPage(body.url);
  }

  @Post('schedule')
  async schedule() {
    await this.scraper.scheduleRecrawl();
    return { ok: true, message: 'Recrawl scheduled' };
  }

  @Get('status')
  async status() {
    return this.scraper.getQueueStats();
  }
}
