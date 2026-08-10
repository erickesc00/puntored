import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ERROR_CODE } from '../../../../shared/vocabulary/error-codes';
import {
  REFERENCE_REPOSITORY,
  type ReferenceRepository,
} from '../ports/reference.repository';
import { serializeReference } from '../../reference-response.mapper';

@Injectable()
export class GetReferenceDetailUseCase {
  constructor(
    @Inject(REFERENCE_REPOSITORY)
    private readonly repository: ReferenceRepository,
  ) {}

  async execute(id: string) {
    const reference = await this.repository.findReferenceById(id);

    if (!reference) {
      throw new NotFoundException({
        code: ERROR_CODE.REFERENCE_NOT_FOUND,
        message: 'Reference not found',
      });
    }

    const history = await this.repository.listReferenceAuditHistory(id);

    return {
      reference: serializeReference(reference),
      history: history.map((event) => ({
        id: event.id,
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action,
        result: event.result,
        correlationId: event.correlationId,
        metadata: event.metadataJson,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }
}
