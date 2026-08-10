import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { compare } from 'bcrypt';
import { ApplicationHttpError } from '../../../../common/errors/application-http.error';
import { AUTH_LOGIN_OUTCOME } from '../../../../shared/vocabulary/auth-login-outcomes';
import { ERROR_CODE } from '../../../../shared/vocabulary/error-codes';
import { LoginDto } from '../../dto/login.dto';
import {
  AUTH_METRICS_PORT,
  type AuthMetricsPort,
} from '../ports/auth-metrics.port';
import {
  SESSION_COOKIE_PORT,
  type SessionCookiePort,
} from '../ports/session-cookie.port';
import {
  AUTH_SESSION_REPOSITORY,
  type AuthSessionRepository,
} from '../ports/session.repository';

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly repository: AuthSessionRepository,
    @Inject(SESSION_COOKIE_PORT)
    private readonly sessionCookie: SessionCookiePort,
    @Inject(AUTH_METRICS_PORT)
    private readonly metrics: AuthMetricsPort,
  ) {}

  async execute(credentials: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.repository.findActiveUserByLogin(
      credentials.username,
    );

    if (!user) {
      this.metrics.recordLoginAttempt(AUTH_LOGIN_OUTCOME.FAILURE);
      throw new ApplicationHttpError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODE.INVALID_CREDENTIALS,
        'Invalid credentials',
      );
    }

    const passwordMatches = await compare(
      credentials.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      this.metrics.recordLoginAttempt(AUTH_LOGIN_OUTCOME.FAILURE);
      throw new ApplicationHttpError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODE.INVALID_CREDENTIALS,
        'Invalid credentials',
      );
    }

    const session = await this.repository.createSession({
      userId: user.id,
      ipAddress,
      userAgent,
    });

    this.metrics.recordLoginAttempt(AUTH_LOGIN_OUTCOME.SUCCESS);

    return {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      session,
      cookie: this.sessionCookie.buildSessionCookie(
        session.id,
        session.expiresAt,
      ),
    };
  }
}
