import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { TelegramService } from './telegram.service';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [ChatModule],
  controllers: [ChannelsController],
  providers: [TelegramService],
})
export class ChannelsModule {}
