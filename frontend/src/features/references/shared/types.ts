export const REFERENCE_STATUSES = ['PENDING', 'PAID', 'CANCELLED', 'EXPIRED'] as const;

export type ReferenceStatus = (typeof REFERENCE_STATUSES)[number];

export interface ReferenceSummary {
  id: string;
  externalReference: string | null;
  concept: string;
  amount: number;
  currency: string;
  dueDate: string;
  status: ReferenceStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    username?: string;
    role?: string;
  };
}

export interface ReferenceListResponse {
  items: ReferenceSummary[];
  pageInfo: {
    nextCursor: string | null;
  };
}

export interface ReferenceAuditEntry {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  result: string;
  correlationId: string | null;
  metadata?: unknown;
  createdAt: string;
}

export interface ReferenceDetailResponse {
  reference: ReferenceSummary;
  history: ReferenceAuditEntry[];
}
