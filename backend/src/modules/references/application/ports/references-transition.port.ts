import type { Prisma } from '@prisma/client';
import type { ErrorCode } from '../../../../shared/vocabulary/error-codes';
import type { ProviderEventOutcome } from '../../../../shared/vocabulary/provider-event-outcomes';
import type { ReferenceRecord } from './reference.repository';

export const REFERENCES_TRANSITION_PORT = Symbol('REFERENCES_TRANSITION_PORT');

export interface ProviderReferenceTransitionInput {
  providerEventId: string;
  referenceId: string;
  externalReference: string;
  status: 'PAID' | 'CANCELLED';
  paidAt?: string;
  occurredAt?: string;
  correlationId?: string;
}

export type ProviderReferenceTransitionResult =
  | {
      kind: 'accepted' | 'already_applied';
      outcome: ProviderEventOutcome;
      reference: ReferenceRecord;
      referenceId: string;
    }
  | {
      kind: 'rejected';
      outcome: ProviderEventOutcome;
      referenceId?: string;
      code: ErrorCode;
      message: string;
      status: 404 | 409;
    };

export interface ReferencesTransitionPort {
  applyProviderEventTransition(
    tx: Prisma.TransactionClient,
    input: ProviderReferenceTransitionInput,
  ): Promise<ProviderReferenceTransitionResult>;
}
