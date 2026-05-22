import {
  Controller, Post, Get, Delete, Param, Query, Body,
  UseGuards, UseInterceptors, UploadedFile, Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
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

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { tags?: string; description?: string },
    @Request() req,
  ) {
    const tags = body.tags ? body.tags.split(',').map(t => t.trim()) : [];
    return this.docs.upload(file, req.user._id, { tags, description: body.description });
  }

  @Get()
  async list(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.docs.list(parseInt(page), parseInt(limit));
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string) {
    return this.docs.retry(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.docs.delete(id);
  }
}
