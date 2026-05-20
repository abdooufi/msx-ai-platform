import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'msx-ai-backend',
    };
  }
}
