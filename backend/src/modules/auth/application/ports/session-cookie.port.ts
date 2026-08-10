import type { CookieOptions, Response } from 'express';

export const SESSION_COOKIE_PORT = Symbol('SESSION_COOKIE_PORT');

export interface SessionCookieDescriptor {
  name: string;
  value: string;
  options: CookieOptions;
}

export interface SessionCookiePort {
  buildSessionCookie(
    sessionId: string,
    expiresAt: Date,
  ): SessionCookieDescriptor;
  setSessionCookie(
    response: Response,
    sessionId: string,
    expiresAt: Date,
  ): void;
  clearSessionCookie(response: Response): void;
}
