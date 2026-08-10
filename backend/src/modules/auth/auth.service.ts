import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { LoginDto } from './dto/login.dto';
import { GetCurrentSessionUseCase } from './application/use-cases/get-current-session.use-case';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import type { SessionAuth } from './guards/session.guard';

@Injectable()
export class AuthService {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly getCurrentSessionUseCase: GetCurrentSessionUseCase,
  ) {}

  async login(credentials: LoginDto, ipAddress?: string, userAgent?: string) {
    return this.loginUseCase.execute(credentials, ipAddress, userAgent);
  }

  async logout(sessionId: string | null) {
    await this.logoutUseCase.execute(sessionId);
  }

  getCurrentSession(user: SessionAuth) {
    return this.getCurrentSessionUseCase.execute(user);
  }

  canCancel(role: UserRole) {
    return role === UserRole.SUPERVISOR;
  }
}
