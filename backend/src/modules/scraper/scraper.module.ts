import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScraperController } from './scraper.controller';
import { ScraperService } from './scraper.service';
import { ScraperProcessor } from './scraper.processor';
import { SCRAPER_QUEUE } from './scraper.constants';

export { SCRAPER_QUEUE, CrawlJobType } from './scraper.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: SCRAPER_QUEUE }),
  ],
  controllers: [ScraperController],
  providers: [ScraperService, ScraperProcessor],
  exports: [ScraperService],
})
export class ScraperModule {}
