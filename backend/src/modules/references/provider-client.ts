import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service';
import { ERROR_CODE } from '../../shared/vocabulary/error-codes';

export interface AllocateReferenceInput {
  backendReferenceId: string;
  concept: string;
  amount: number;
  currency: string;
  dueDate: string;
}

export interface AllocateReferenceResult {
  backendReferenceId: string;
  externalReference: string;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  createdAt: string;
}

@Injectable()
export class ProviderAllocationClient {
  constructor(private readonly config: AppConfigService) {}

  get isEnabled() {
    return this.config.providerAllocation.enabled;
  }

  async allocateReference(
    payload: AllocateReferenceInput,
  ): Promise<AllocateReferenceResult> {
    const response = await this.performRequest(payload);

    if (!response.ok) {
      const errorPayload: unknown = await safeReadBody(response);
      throw new ServiceUnavailableException({
        code: ERROR_CODE.PROVIDER_ALLOCATION_FAILED,
        message: 'Provider allocation request failed',
        providerStatusCode: response.status,
        providerPayload: errorPayload,
      });
    }

    const data: unknown = await safeReadBody(response);

    if (!isAllocateReferenceResult(data)) {
      throw new ServiceUnavailableException({
        code: ERROR_CODE.PROVIDER_ALLOCATION_INVALID_RESPONSE,
        message: 'Provider allocation returned an invalid response',
      });
    }

    return {
      backendReferenceId: data.backendReferenceId,
      externalReference: data.externalReference,
      status: data.status,
      createdAt: data.createdAt,
    };
  }

  private async performRequest(payload: AllocateReferenceInput) {
    try {
      return await fetch(
        `${this.config.providerAllocation.baseUrl}/external-references`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-stub-api-key': this.config.providerAllocation.apiKey,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.config.providerAllocation.timeoutMs),
        },
      );
    } catch (error) {
      throw new ServiceUnavailableException({
        code: ERROR_CODE.PROVIDER_ALLOCATION_UNAVAILABLE,
        message: 'Provider allocation service is unavailable',
        cause: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
}

async function safeReadBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return (await response.json()) as unknown;
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

function isAllocateReferenceResult(
  value: unknown,
): value is AllocateReferenceResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.backendReferenceId === 'string' &&
    typeof candidate.externalReference === 'string' &&
    (candidate.status === 'PENDING' ||
      candidate.status === 'PAID' ||
      candidate.status === 'CANCELLED') &&
    typeof candidate.createdAt === 'string'
  );
}
