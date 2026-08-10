import { Injectable } from '@nestjs/common';
import { ProcessProviderEventUseCase } from './application/use-cases/process-provider-event.use-case';
import { ProviderCallbackDto } from './dto/provider-callback.dto';

@Injectable()
export class ProviderEventsService {
  constructor(
    private readonly processProviderEventUseCase: ProcessProviderEventUseCase,
  ) {}

  processProviderEvent(payload: ProviderCallbackDto, correlationId?: string) {
    return this.processProviderEventUseCase.execute(payload, correlationId);
  }
}
