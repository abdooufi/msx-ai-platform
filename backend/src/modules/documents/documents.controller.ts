import {
  Controller, Post, Get, Delete, Param, Query, Body,
  UseGuards, UseInterceptors, UploadedFile, Request, HttpCode, HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiOperation, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/guards/roles.decorator';
import { DocumentsService } from './documents.service';

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'editor', 'agent')
@Controller('upload')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  // ── File upload ───────────────────────────────────────────────────────────

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a document (PDF/DOCX/XLSX/CSV/TXT/ZIP)' })
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { tags?: string; description?: string; companySymbol?: string },
    @Request() req,
  ) {
    const tags = body.tags ? body.tags.split(',').map(t => t.trim()) : [];
    return this.docs.upload(file, req.user._id, {
      tags,
      description:   body.description,
      companySymbol: body.companySymbol || undefined,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List uploaded documents' })
  async list(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.docs.list(parseInt(page), parseInt(limit));
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Re-queue a failed document' })
  async retry(@Param('id') id: string) {
    return this.docs.retry(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a document' })
  async remove(@Param('id') id: string) {
    return this.docs.delete(id);
  }

  // ── URL ingestion ─────────────────────────────────────────────────────────

  @Post('from-url')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Fetch a URL, find all document links, queue new ones for indexing' })
  @ApiBody({
    schema: {
      properties: {
        url:           { type: 'string', example: 'https://example.com/reports/' },
        companySymbol: { type: 'string', example: 'OQEP' },
      },
      required: ['url'],
    },
  })
  async fromUrl(@Body() body: { url: string; companySymbol?: string }) {
    if (!body?.url) throw new Error('url is required');
    return this.docs.uploadFromUrl(body.url, body.companySymbol);
  }

  // ── URL watch schedules ───────────────────────────────────────────────────

  @Get('url-schedules')
  @ApiOperation({ summary: 'List all URL watch schedules' })
  async listSchedules() {
    return this.docs.getUrlSchedules();
  }

  @Post('url-schedule')
  @ApiOperation({ summary: 'Add (or update) a URL watch schedule' })
  @ApiBody({
    schema: {
      properties: {
        url:           { type: 'string' },
        cron:          { type: 'string', example: '0 2 * * *' },
        companySymbol: { type: 'string' },
      },
      required: ['url', 'cron'],
    },
  })
  async setSchedule(@Body() body: { url: string; cron: string; companySymbol?: string }) {
    if (!body?.url || !body?.cron) throw new Error('url and cron are required');
    return this.docs.setUrlSchedule(body.url, body.cron, body.companySymbol);
  }

  @Delete('url-schedule/:id')
  @ApiOperation({ summary: 'Cancel a URL watch schedule' })
  async cancelSchedule(@Param('id') id: string) {
    return this.docs.cancelUrlSchedule(id);
  }
}
