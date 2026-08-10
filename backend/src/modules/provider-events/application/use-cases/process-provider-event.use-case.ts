import { Inject, Injectable } from '@nestjs/common';
import { ProviderCallbackDto } from '../../dto/provider-callback.dto';
import {
  PROVIDER_EVENT_PROCESSOR,
  type ProviderEventProcessor,
} from '../ports/provider-event-processor.port';

@Injectable()
export class ProcessProviderEventUseCase {
  constructor(
    @Inject(PROVIDER_EVENT_PROCESSOR)
    private readonly processor: ProviderEventProcessor,
  ) {}

  execute(payload: ProviderCallbackDto, correlationId?: string) {
    return this.processor.processProviderEvent(payload, correlationId);
  }
}
