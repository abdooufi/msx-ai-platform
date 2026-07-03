import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AnswerCacheService } from './answer-cache.service';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    AdminModule,    // provides DynamicApiService + ChatbootPgService
  ],
  controllers: [ChatController],
  providers: [ChatService, AnswerCacheService],
  exports: [ChatService],
})
export class ChatModule {}
