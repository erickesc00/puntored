import { Injectable } from '@nestjs/common';
import {
  type AllocateReferenceInput,
  type ProviderAllocationPort,
} from '../../application/ports/provider-allocation.port';
import { ProviderAllocationClient } from '../../provider-client';

@Injectable()
export class ProviderAllocationAdapter implements ProviderAllocationPort {
  constructor(
    private readonly providerAllocationClient: ProviderAllocationClient,
  ) {}

  get isEnabled() {
    return this.providerAllocationClient.isEnabled;
  }

  allocateReference(payload: AllocateReferenceInput) {
    return this.providerAllocationClient.allocateReference(payload);
  }
}
