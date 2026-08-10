import { Injectable } from '@nestjs/common';
import { ListReferencesDto } from './dto/list-references.dto';
import { CreateReferenceUseCase } from './application/use-cases/create-reference.use-case';
import { CancelReferenceUseCase } from './application/use-cases/cancel-reference.use-case';
import { GetReferenceDetailUseCase } from './application/use-cases/get-reference-detail.use-case';
import { ListReferencesUseCase } from './application/use-cases/list-references.use-case';

@Injectable()
export class ReferencesService {
  constructor(
    private readonly createReferenceUseCase: CreateReferenceUseCase,
    private readonly cancelReferenceUseCase: CancelReferenceUseCase,
    private readonly listReferencesUseCase: ListReferencesUseCase,
    private readonly getReferenceDetailUseCase: GetReferenceDetailUseCase,
  ) {}

  createReference(...args: Parameters<CreateReferenceUseCase['execute']>) {
    return this.createReferenceUseCase.execute(...args);
  }

  async listReferences(query: ListReferencesDto) {
    return this.listReferencesUseCase.execute(query);
  }

  getReferenceDetail(id: string) {
    return this.getReferenceDetailUseCase.execute(id);
  }

  cancelReference(...args: Parameters<CancelReferenceUseCase['execute']>) {
    return this.cancelReferenceUseCase.execute(...args);
  }
}
