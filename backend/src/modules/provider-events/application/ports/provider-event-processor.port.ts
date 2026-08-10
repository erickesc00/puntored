import type { ProviderCallbackDto } from '../../dto/provider-callback.dto';

export const PROVIDER_EVENT_PROCESSOR = Symbol('PROVIDER_EVENT_PROCESSOR');

export interface ProviderEventProcessorResult {
  providerEventId: string;
  outcome: string;
  duplicate: boolean;
  reference: {
    id: string;
    externalReference: string | null;
    concept: string;
    amount: number;
    currency: string;
    dueDate: string;
    status: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    createdBy: {
      id: string;
    };
  };
}

export interface ProviderEventProcessor {
  processProviderEvent(
    payload: ProviderCallbackDto,
    correlationId?: string,
  ): Promise<ProviderEventProcessorResult>;
}
