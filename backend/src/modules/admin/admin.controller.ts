import { Controller, Get, Patch, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/guards/roles.decorator';
import { AdminService } from './admin.service';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'agent')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  getStats() {
    return this.admin.getDashboardStats();
  }

  @Get('conversations')
  async getConversations(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('lang') lang?: string,
  ): Promise<any> {
    const filter = lang ? { language: lang } : {};
    return this.admin.getConversations(parseInt(page), parseInt(limit), filter);
  }

  @Get('failed')
  getFailed(@Query('page') page = '1') {
    return this.admin.getFailedQuestions(parseInt(page));
  }

  @Get('settings')
  getSettings() {
    return this.admin.getSettings();
  }
}
