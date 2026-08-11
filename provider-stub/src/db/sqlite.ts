import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export const providerReferenceStatuses = ['PENDING', 'PAID', 'CANCELLED'] as const;

export type ProviderReferenceStatus =
  (typeof providerReferenceStatuses)[number];

export interface ProviderReferenceRecord {
  backendReferenceId: string;
  externalReference: string;
  concept: string;
  amount: number;
  currency: string;
  dueDate: string;
  status: ProviderReferenceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProviderReferenceInput {
  backendReferenceId: string;
  concept: string;
  amount: number;
  currency: string;
  dueDate: string;
}

export interface StoreProviderCreatedReferenceInput {
  backendReferenceId: string;
  externalReference: string;
  concept: string;
  amount: number;
  currency: string;
  dueDate: string;
}

export interface ListProviderReferencesInput {
  status?: ProviderReferenceStatus;
  backendReferenceId?: string;
}

type ProviderReferenceRow = {
  backend_reference_id: string;
  external_reference: string;
  concept: string;
  amount: number;
  currency: string;
  due_date: string;
  status: ProviderReferenceStatus;
  created_at: string;
  updated_at: string;
};

export class ProviderReferenceRepository {
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS external_references (
        backend_reference_id TEXT PRIMARY KEY,
        external_reference TEXT NOT NULL UNIQUE,
        concept TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_external_references_status
        ON external_references (status, created_at DESC);
    `);
  }

  storeProviderCreated(
    input: StoreProviderCreatedReferenceInput,
  ): ProviderReferenceRecord {
    const byBackendReferenceId = this.findByBackendReferenceId(
      input.backendReferenceId,
    );

    if (byBackendReferenceId) {
      if (
        byBackendReferenceId.externalReference !== input.externalReference ||
        byBackendReferenceId.concept !== input.concept ||
        byBackendReferenceId.amount !== input.amount ||
        byBackendReferenceId.currency !== input.currency ||
        byBackendReferenceId.dueDate !== input.dueDate
      ) {
        throw new Error(
          'Stored provider mapping conflicts with the backend response',
        );
      }

      return byBackendReferenceId;
    }

    const now = new Date().toISOString();
    const record: ProviderReferenceRecord = {
      backendReferenceId: input.backendReferenceId,
      externalReference: input.externalReference,
      concept: input.concept,
      amount: input.amount,
      currency: input.currency,
      dueDate: input.dueDate,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    };

    this.database
      .prepare(
        `
        INSERT INTO external_references (
          backend_reference_id,
          external_reference,
          concept,
          amount,
          currency,
          due_date,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        record.backendReferenceId,
        record.externalReference,
        record.concept,
        record.amount,
        record.currency,
        record.dueDate,
        record.status,
        record.createdAt,
        record.updatedAt,
      );

    return record;
  }

  createOrGet(input: CreateProviderReferenceInput): ProviderReferenceRecord {
    const existing = this.findByBackendReferenceId(input.backendReferenceId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const record: ProviderReferenceRecord = {
      backendReferenceId: input.backendReferenceId,
      externalReference: buildExternalReference(input.backendReferenceId),
      concept: input.concept,
      amount: input.amount,
      currency: input.currency,
      dueDate: input.dueDate,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    };

    this.database
      .prepare(
        `
        INSERT INTO external_references (
          backend_reference_id,
          external_reference,
          concept,
          amount,
          currency,
          due_date,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        record.backendReferenceId,
        record.externalReference,
        record.concept,
        record.amount,
        record.currency,
        record.dueDate,
        record.status,
        record.createdAt,
        record.updatedAt,
      );

    return record;
  }

  findByBackendReferenceId(
    backendReferenceId: string,
  ): ProviderReferenceRecord | null {
    const row = this.database
      .prepare(
        `
        SELECT
          backend_reference_id,
          external_reference,
          concept,
          amount,
          currency,
          due_date,
          status,
          created_at,
          updated_at
        FROM external_references
        WHERE backend_reference_id = ?
      `,
      )
      .get(backendReferenceId) as ProviderReferenceRow | undefined;

    return row ? mapRow(row) : null;
  }

  list(input: ListProviderReferencesInput = {}): ProviderReferenceRecord[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];

    if (input.status) {
      clauses.push('status = ?');
      params.push(input.status);
    }

    if (input.backendReferenceId) {
      clauses.push('backend_reference_id = ?');
      params.push(input.backendReferenceId);
    }

    const rows = this.database
      .prepare(
        `
        SELECT
          backend_reference_id,
          external_reference,
          concept,
          amount,
          currency,
          due_date,
          status,
          created_at,
          updated_at
        FROM external_references
        ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY created_at DESC, backend_reference_id DESC
      `,
      )
      .all(...params) as ProviderReferenceRow[];

    return rows.map(mapRow);
  }

  updateStatus(
    backendReferenceId: string,
    status: ProviderReferenceStatus,
  ): ProviderReferenceRecord | null {
    const existing = this.findByBackendReferenceId(backendReferenceId);
    if (!existing) {
      return null;
    }

    const updatedAt = new Date().toISOString();

    this.database
      .prepare(
        `
        UPDATE external_references
        SET status = ?, updated_at = ?
        WHERE backend_reference_id = ?
      `,
      )
      .run(status, updatedAt, backendReferenceId);

    return this.findByBackendReferenceId(backendReferenceId);
  }

  close() {
    this.database.close();
  }
}

export function createProviderReferenceRepository(databasePath: string) {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  return new ProviderReferenceRepository(new DatabaseSync(databasePath));
}

export function buildExternalReference(backendReferenceId: string) {
  const suffix = createHash('sha256')
    .update(backendReferenceId)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();

  return `EXT-${suffix}`;
}

function mapRow(row: ProviderReferenceRow): ProviderReferenceRecord {
  return {
    backendReferenceId: row.backend_reference_id,
    externalReference: row.external_reference,
    concept: row.concept,
    amount: row.amount,
    currency: row.currency,
    dueDate: row.due_date,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
