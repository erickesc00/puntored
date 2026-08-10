import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { AppConfigService } from '../../../../common/config/app-config.service';
import type {
  SessionCookieDescriptor,
  SessionCookiePort,
} from '../../application/ports/session-cookie.port';

@Injectable()
export class SessionCookieAdapter implements SessionCookiePort {
  constructor(private readonly config: AppConfigService) {}

  buildSessionCookie(
    sessionId: string,
    expiresAt: Date,
  ): SessionCookieDescriptor {
    return {
      name: this.config.session.cookieName,
      value: sessionId,
      options: {
        ...this.config.session.cookieOptions,
        expires: expiresAt,
      },
    };
  }

  setSessionCookie(response: Response, sessionId: string, expiresAt: Date) {
    const cookie = this.buildSessionCookie(sessionId, expiresAt);
    response.cookie(cookie.name, cookie.value, cookie.options);
  }

  clearSessionCookie(response: Response) {
    response.clearCookie(
      this.config.session.cookieName,
      this.config.session.cookieOptions,
    );
  }
}
