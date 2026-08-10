import { Module } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service';
import { ReferencesModule } from '../references/references.module';
import { PROVIDER_EVENT_PROCESSOR } from './application/ports/provider-event-processor.port';
import { ProcessProviderEventUseCase } from './application/use-cases/process-provider-event.use-case';
import { PrismaProviderEventProcessor } from './infrastructure/persistence/prisma-provider-event.processor';
import { ProviderEventsController } from './provider-events.controller';
import { ProviderEventsService } from './provider-events.service';
import { ProviderAuthGuard } from './guards/provider-auth.guard';

@Module({
  imports: [ReferencesModule],
  controllers: [ProviderEventsController],
  providers: [
    AppConfigService,
    ProviderAuthGuard,
    ProviderEventsService,
    ProcessProviderEventUseCase,
    PrismaProviderEventProcessor,
    {
      provide: PROVIDER_EVENT_PROCESSOR,
      useExisting: PrismaProviderEventProcessor,
    },
  ],
})
export class ProviderEventsModule {}
