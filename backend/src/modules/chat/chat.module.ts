import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { Conversation, ConversationSchema } from '../../schemas/conversation.schema';
import { AnalyticsEvent, AnalyticsEventSchema } from '../../schemas/analytics.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: AnalyticsEvent.name, schema: AnalyticsEventSchema },
    ]),
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
