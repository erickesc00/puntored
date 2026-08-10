import {
  Inject,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { Request, Response } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppConfigService } from '../../../common/config/app-config.service';
import { ERROR_CODE } from '../../../shared/vocabulary/error-codes';
import {
  SESSION_COOKIE_PORT,
  type SessionCookiePort,
} from '../application/ports/session-cookie.port';
import {
  AUTH_SESSION_REPOSITORY,
  type AuthSessionRepository,
} from '../application/ports/session.repository';

export interface SessionAuth {
  userId: string;
  username: string;
  role: UserRole;
  sessionId: string;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly repository: AuthSessionRepository,
    private readonly config: AppConfigService,
    @Inject(SESSION_COOKIE_PORT)
    private readonly sessionCookie: SessionCookiePort,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const sessionId = request.cookies?.[this.config.session.cookieName] as
      string | undefined;

    if (!sessionId) {
      throw new UnauthorizedException({
        code: ERROR_CODE.SESSION_REQUIRED,
        message: 'Authentication required',
      });
    }

    const session = await this.repository.findSessionWithUser(sessionId);

    if (!session || !session.user.active) {
      this.sessionCookie.clearSessionCookie(response);
      throw new UnauthorizedException({
        code: ERROR_CODE.SESSION_REQUIRED,
        message: 'Authentication required',
      });
    }

    const now = new Date();
    if (session.expiresAt <= now || session.absoluteExpiresAt <= now) {
      await this.repository.deleteSession(session.id);
      this.sessionCookie.clearSessionCookie(response);
      throw new UnauthorizedException({
        code: ERROR_CODE.SESSION_EXPIRED,
        message: 'Session expired',
      });
    }

    const nextIdleExpiry = new Date(
      now.getTime() + this.config.session.idleTtlMinutes * 60 * 1000,
    );
    const expiresAt =
      nextIdleExpiry <= session.absoluteExpiresAt
        ? nextIdleExpiry
        : session.absoluteExpiresAt;

    await this.repository.refreshSession(session.id, now, expiresAt);

    this.sessionCookie.setSessionCookie(response, session.id, expiresAt);

    request.auth = {
      userId: session.user.id,
      username: session.user.username,
      role: session.user.role,
      sessionId: session.id,
    };

    return true;
  }
}
