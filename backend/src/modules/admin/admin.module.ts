import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ChatbootPgService } from './chatboot-pg.service';
import { PgIndexingService } from './pg-indexing.service';
import { DynamicApiService } from './dynamic-api.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    AuditModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, ChatbootPgService, PgIndexingService, DynamicApiService],
  exports: [ChatbootPgService, PgIndexingService, DynamicApiService],
})
export class AdminModule {}
