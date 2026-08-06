import { Module } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service';
import { ProviderEventsController } from './provider-events.controller';
import { ProviderEventsService } from './provider-events.service';
import { ProviderAuthGuard } from './guards/provider-auth.guard';

@Module({
  controllers: [ProviderEventsController],
  providers: [AppConfigService, ProviderAuthGuard, ProviderEventsService],
})
export class ProviderEventsModule {}
