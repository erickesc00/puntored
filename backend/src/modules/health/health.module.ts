import { Module } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [AppConfigService, HealthService],
})
export class HealthModule {}
