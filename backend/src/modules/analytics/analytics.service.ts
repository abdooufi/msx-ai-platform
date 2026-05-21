import { Injectable } from '@nestjs/common';
import { AppPgService } from '../database/app-pg.service';

@Injectable()
export class AnalyticsService {
  constructor(private pg: AppPgService) {}

  async getSummary(days = 7) {
    return this.pg.getAnalyticsSummary(days);
  }
}
