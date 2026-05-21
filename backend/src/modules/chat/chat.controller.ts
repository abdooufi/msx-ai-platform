import {
  Controller, Post, Get, Body, Param, Query, Req, Res,
  UseGuards, HttpCode, HttpStatus, Ip,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ChatService } from './chat.service';
import { ChatRequestDto, FeedbackDto } from './chat.dto';
import { ChatbootPgService } from '../admin/chatboot-pg.service';

@ApiTags('Chat')
@UseGuards(ThrottlerGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly pg: ChatbootPgService,
  ) {}

  /**
   * POST /api/chat
   * Main chat endpoint — streams Server-Sent Events.
   * Client: EventSource or fetch with ReadableStream.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a message and receive streaming AI response' })
  async chat(
    @Body() dto: ChatRequestDto,
    @Req() req: Request,
    @Res() res: Response,
    @Ip() ip: string,
  ) {
    dto.channel = dto.channel || 'web';
    return this.chatService.streamChat(dto, res);
  }

  /**
   * POST /api/chat/feedback
   * Submit thumbs-up / thumbs-down on an assistant message.
   */
  @Post('feedback')
  @HttpCode(HttpStatus.OK)
  async feedback(@Body() dto: FeedbackDto) {
    return this.chatService.submitFeedback(
      dto.sessionId,
      dto.messageId,
      dto.feedback,
      dto.note,
    );
  }

  /**
   * GET /api/chat/session/:sessionId
   * Retrieve a conversation by session ID.
   */
  @Get('session/:sessionId')
  async getSession(@Param('sessionId') sessionId: string) {
    return this.chatService.getConversation(sessionId);
  }

  /**
   * GET /api/chat/suggestions?lang=en
   * Quick-start suggestions shown in the chat UI.
   */
  @Get('suggestions')
  async getSuggestions(@Query('lang') lang: string = 'en') {
    const language = lang === 'ar' ? 'ar' : 'en';
    return { suggestions: await this.chatService.getSuggestions(language) };
  }

  /**
   * GET /api/chat/companies?q=oqep
   * Public endpoint — returns matching company symbols for chat autocomplete.
   * No auth required. Used by the "/" trigger in the chat input.
   */
  @Get('companies')
  @ApiOperation({ summary: 'Search company symbols for chat / autocomplete (public)' })
  @ApiQuery({ name: 'q', required: false, description: 'Symbol / name filter' })
  async getCompanySymbols(@Query('q') q?: string) {
    const result = await this.pg.getCompanies(1, 40, q || undefined);
    return (result.data as any[]).map(c => ({
      symbol:  c.symbol,
      nameEn:  c.long_name_en  ?? c.short_name_en ?? c.symbol,
      nameAr:  c.long_name_ar  ?? c.short_name_ar ?? '',
    }));
  }
}
