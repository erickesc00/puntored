import { Inject, Injectable } from '@nestjs/common';
import { ListReferencesDto } from '../../dto/list-references.dto';
import {
  REFERENCE_REPOSITORY,
  type ReferenceRepository,
} from '../ports/reference.repository';
import {
  decodeCursor,
  encodeCursor,
  serializeReference,
} from '../../reference-response.mapper';

@Injectable()
export class ListReferencesUseCase {
  constructor(
    @Inject(REFERENCE_REPOSITORY)
    private readonly repository: ReferenceRepository,
  ) {}

  async execute(query: ListReferencesDto) {
    const limit = query.limit ?? 20;
    const now = new Date();
    const cursor = decodeCursor(query.cursor);

    const references = await this.repository.listReferences({
      ...query,
      cursor,
      limit,
      now,
    });

    const hasMore = references.length > limit;
    const items = references
      .slice(0, limit)
      .map((reference) => serializeReference(reference, now));
    const lastItem = references[limit - 1];

    return {
      items,
      pageInfo: {
        nextCursor:
          hasMore && lastItem
            ? encodeCursor({
                createdAt: lastItem.createdAt.toISOString(),
                id: lastItem.id,
              })
            : null,
      },
    };
  }
}
