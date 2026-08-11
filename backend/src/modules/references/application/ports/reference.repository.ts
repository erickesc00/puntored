import type {
  AuditActorType,
  ReferenceCreatorActorType,
  ReferenceStatus,
  UserRole,
} from '@prisma/client';
import type { AuditAction } from '../../../../shared/vocabulary/audit-actions';
import type { AuditResult } from '../../../../shared/vocabulary/audit-results';

export const REFERENCE_REPOSITORY = Symbol('REFERENCE_REPOSITORY');

export interface ReferenceRecord {
  id: string;
  externalReference: string | null;
  concept: string;
  amount: bigint;
  currency: string;
  dueAt: Date;
  status: ReferenceStatus;
  version: number;
  creatorActorType: ReferenceCreatorActorType;
  creatorActorId: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  creator?: {
    id: string;
    username: string;
    role: UserRole;
  } | null;
}

export interface StoredIdempotencyRecord {
  requestHash: string;
  referenceId: string | null;
}

export interface ReferenceStatusSnapshot {
  version: number;
  status: ReferenceStatus;
  dueAt: Date;
}

export interface ReferenceAuditRecord {
  id: string;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  result: string;
  correlationId: string | null;
  metadataJson: unknown;
  createdAt: Date;
}

export interface ReferenceListCursor {
  createdAt: string;
  id: string;
}

export interface ListReferencesQuery {
  status?: ReferenceStatus;
  createdFrom?: string;
  createdTo?: string;
  search?: string;
  cursor?: ReferenceListCursor | null;
  limit: number;
  now: Date;
}

export interface ExpirationCandidate {
  id: string;
  version: number;
  dueAt: Date;
}

export interface ExpireResult {
  expired: boolean;
  newVersion?: number;
}

export interface AppendReferenceAuditEntry {
  referenceId?: string;
  actorType: AuditActorType;
  actorId?: string;
  action: AuditAction;
  result: AuditResult;
  correlationId?: string;
  metadataJson?: Record<string, unknown>;
}

export interface CreateReferencePersistenceInput {
  actorId: string;
  concept: string;
  amount: number;
  currency: string;
  dueAt: Date;
  idempotencyScope: string;
  idempotencyKey: string;
  requestHash: string;
  correlationId?: string;
  referenceId?: string;
  externalReference?: string | null;
}

export interface CancelPendingReferenceInput {
  referenceId: string;
  expectedVersion: number;
  transitionCutoff: Date;
  actorId: string;
  correlationId?: string;
}

export interface CreateProviderReferencePersistenceInput {
  actorId: string;
  externalReference: string;
  concept: string;
  amount: number;
  currency: string;
  dueAt: Date;
  correlationId?: string;
}

export interface ReferenceRepository {
  findIdempotencyRecord(
    scope: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<StoredIdempotencyRecord | null>;
  findReferenceById(id: string): Promise<ReferenceRecord | null>;
  findReferenceByExternalReference(
    externalReference: string,
  ): Promise<ReferenceRecord | null>;
  findReferenceStatusSnapshot(
    id: string,
  ): Promise<ReferenceStatusSnapshot | null>;
  listReferences(query: ListReferencesQuery): Promise<ReferenceRecord[]>;
  listReferenceAuditHistory(
    referenceId: string,
  ): Promise<ReferenceAuditRecord[]>;
  appendAuditEvent(entry: AppendReferenceAuditEntry): Promise<void>;
  persistCreatedReference(
    input: CreateReferencePersistenceInput,
  ): Promise<ReferenceRecord>;
  persistProviderCreatedReference(
    input: CreateProviderReferencePersistenceInput,
  ): Promise<ReferenceRecord>;
  cancelPendingReference(
    input: CancelPendingReferenceInput,
  ): Promise<ReferenceRecord | null>;
  listOverduePendingReferences(
    limit: number,
    now: Date,
  ): Promise<ExpirationCandidate[]>;
  expireReferenceIfStillPending(
    candidate: ExpirationCandidate,
    now: Date,
    actorId: string,
  ): Promise<ExpireResult>;
}
