import {
  Controller, Post, Get, Body, Param, HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TelegramService } from './telegram.service';

@ApiTags('Channels')
@Controller('channels')
export class ChannelsController {
  constructor(private readonly telegram: TelegramService) {}

  /**
   * POST /api/channels/telegram/webhook/:secret
   * Telegram webhook receiver. The :secret path segment must match
   * TELEGRAM_WEBHOOK_SECRET — Telegram cannot send auth headers.
   * Always returns 200 so Telegram does not retry (retries duplicate answers).
   */
  @Post('telegram/webhook/:secret')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async telegramWebhook(@Param('secret') secret: string, @Body() update: any) {
    if (!this.telegram.verifySecret(secret)) return { ok: true };
    // Fire-and-forget: answer generation can exceed Telegram's webhook timeout
    void this.telegram.handleUpdate(update);
    return { ok: true };
  }

  /**
   * GET /api/channels/status
   * Admin: which external channels are configured.
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Channel integration status' })
  getStatus() {
    return {
      web:      { enabled: true },
      telegram: { enabled: this.telegram.configured },
    };
  }
}
