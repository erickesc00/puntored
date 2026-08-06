import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  async getHealth(@Res({ passthrough: true }) response: Response) {
    const health = await this.healthService.getHealth();
    response.status(
      health.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );

    return health;
  }
}
