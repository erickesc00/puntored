import { Inject, Injectable } from '@nestjs/common';
import {
  AUTH_SESSION_REPOSITORY,
  type AuthSessionRepository,
} from '../ports/session.repository';

@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly repository: AuthSessionRepository,
  ) {}

  async execute(sessionId: string | null) {
    if (!sessionId) {
      return;
    }

    await this.repository.deleteSession(sessionId);
  }
}
