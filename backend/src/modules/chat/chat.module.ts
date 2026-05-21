import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    AdminModule,    // provides DynamicApiService
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
