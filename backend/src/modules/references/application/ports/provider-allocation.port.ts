export const REFERENCE_PROVIDER_ALLOCATION_PORT = Symbol(
  'REFERENCE_PROVIDER_ALLOCATION_PORT',
);

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

export interface ProviderAllocationPort {
  readonly isEnabled: boolean;
  allocateReference(
    payload: AllocateReferenceInput,
  ): Promise<AllocateReferenceResult>;
}
