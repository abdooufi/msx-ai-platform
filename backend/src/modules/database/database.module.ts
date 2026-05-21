import { Global, Module } from '@nestjs/common';
import { AppPgService } from './app-pg.service';

@Global()
@Module({
  providers: [AppPgService],
  exports:   [AppPgService],
})
export class DatabaseModule {}
