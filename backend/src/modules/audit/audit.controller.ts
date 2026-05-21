import {
  Controller, Get, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/guards/roles.decorator';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'List audit logs (paginated, filterable)' })
  @ApiQuery({ name: 'page',     required: false })
  @ApiQuery({ name: 'limit',    required: false })
  @ApiQuery({ name: 'action',   required: false })
  @ApiQuery({ name: 'resource', required: false })
  @ApiQuery({ name: 'email',    required: false })
  @ApiQuery({ name: 'from',     required: false })
  @ApiQuery({ name: 'to',       required: false })
  list(
    @Query('page')     page     = '1',
    @Query('limit')    limit    = '50',
    @Query('action')   action?:   string,
    @Query('resource') resource?: string,
    @Query('email')    email?:    string,
    @Query('from')     from?:     string,
    @Query('to')       to?:       string,
  ) {
    return this.audit.list({
      page:  parseInt(page),
      limit: parseInt(limit),
      action, resource, email, from, to,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Audit log summary stats (total, today, byAction)' })
  stats() {
    return this.audit.stats();
  }
}
