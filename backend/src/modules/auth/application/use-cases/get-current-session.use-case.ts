import { Injectable } from '@nestjs/common';
import type { SessionAuth } from '../../guards/session.guard';

@Injectable()
export class GetCurrentSessionUseCase {
  execute(user: SessionAuth) {
    return { user };
  }
}
