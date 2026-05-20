import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ChatbootPgService } from './chatboot-pg.service';
import { PgIndexingService } from './pg-indexing.service';
import { DynamicApiService } from './dynamic-api.service';
import { Conversation, ConversationSchema } from '../../schemas/conversation.schema';
import { AnalyticsEvent, AnalyticsEventSchema } from '../../schemas/analytics.schema';
import { Knowledge, KnowledgeSchema } from '../../schemas/knowledge.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: AnalyticsEvent.name, schema: AnalyticsEventSchema },
      { name: Knowledge.name, schema: KnowledgeSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService, ChatbootPgService, PgIndexingService, DynamicApiService],
  exports: [ChatbootPgService, PgIndexingService, DynamicApiService],
})
export class AdminModule {}
