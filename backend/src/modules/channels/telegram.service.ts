import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ChatService } from '../chat/chat.service';

/**
 * Telegram channel — lets users chat with the MSX assistant from Telegram.
 *
 * Setup:
 *   1. Create a bot with @BotFather and put the token in TELEGRAM_BOT_TOKEN.
 *   2. Set TELEGRAM_WEBHOOK_SECRET to any random string.
 *   3. Point the webhook at your server:
 *      curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://YOUR_SERVER/api/channels/telegram/webhook/<SECRET>"
 *
 * When TELEGRAM_BOT_TOKEN is not set the channel is inert (webhook returns ok
 * without doing anything), so the module is always safe to load.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string;
  private readonly webhookSecret: string;

  constructor(
    private config: ConfigService,
    private chat: ChatService,
  ) {
    this.token         = config.get<string>('TELEGRAM_BOT_TOKEN', '');
    this.webhookSecret = config.get<string>('TELEGRAM_WEBHOOK_SECRET', '');
    if (this.token) this.logger.log('📱 Telegram channel enabled');
  }

  get configured(): boolean {
    return !!this.token && !!this.webhookSecret;
  }

  verifySecret(secret: string): boolean {
    return this.configured && secret === this.webhookSecret;
  }

  /**
   * Handle one Telegram update. Always resolves — Telegram retries on non-200,
   * which would spam users with duplicate answers.
   */
  async handleUpdate(update: any): Promise<void> {
    try {
      const msg = update?.message;
      const chatId: number | undefined = msg?.chat?.id;
      const text: string | undefined = msg?.text;
      if (!chatId || !text) return;

      if (text.startsWith('/start')) {
        await this.sendMessage(chatId,
          'مرحباً! أنا مساعد بورصة مسقط الذكي 🤖\n' +
          'Welcome! I am the MSX Smart Assistant. Ask me about stocks, companies, and market data on the Muscat Stock Exchange.');
        return;
      }

      const { text: answer } = await this.chat.chatOnce({
        message:   text.slice(0, 2000),
        sessionId: `tg_${chatId}`,
        channel:   'telegram',
      });
      await this.sendMessage(chatId, answer);
    } catch (err) {
      this.logger.error(`Telegram update failed: ${err.message}`);
    }
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    // Telegram hard limit is 4096 chars per message
    const chunks = text.match(/[\s\S]{1,4000}/g) ?? [];
    for (const chunk of chunks) {
      try {
        await axios.post(
          `https://api.telegram.org/bot${this.token}/sendMessage`,
          { chat_id: chatId, text: chunk, parse_mode: 'Markdown' },
          { timeout: 15_000 },
        );
      } catch (err) {
        // Markdown parse errors are common with LLM output — retry as plain text
        if (err?.response?.status === 400) {
          await axios.post(
            `https://api.telegram.org/bot${this.token}/sendMessage`,
            { chat_id: chatId, text: chunk },
            { timeout: 15_000 },
          ).catch(e => this.logger.error(`Telegram send failed: ${e.message}`));
        } else {
          this.logger.error(`Telegram send failed: ${err.message}`);
        }
      }
    }
  }
}
