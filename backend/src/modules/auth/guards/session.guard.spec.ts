import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { SessionGuard } from './session.guard';

describe('SessionGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };

  const prisma = {
    findSessionWithUser: jest.fn(),
    refreshSession: jest.fn(),
    deleteSession: jest.fn(),
  };

  const config = {
    session: {
      cookieName: 'puntored.sid',
      idleTtlMinutes: 30,
    },
  };

  const sessionCookie = {
    clearSessionCookie: jest.fn(),
    setSessionCookie: jest.fn(),
  };

  let guard: SessionGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(false);
    guard = new SessionGuard(
      reflector as unknown as Reflector,
      prisma as never,
      config as never,
      sessionCookie as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects expired sessions and deletes them from persistence', async () => {
    prisma.findSessionWithUser.mockResolvedValue({
      id: 'session-1',
      expiresAt: new Date(Date.now() - 1_000),
      absoluteExpiresAt: new Date(Date.now() + 1_000),
      user: {
        id: 'user-1',
        username: 'operator',
        role: UserRole.OPERATOR,
        active: true,
      },
    });

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          cookies: { 'puntored.sid': 'session-1' },
        }),
        getResponse: () => ({}),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as never;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.deleteSession).toHaveBeenCalledWith('session-1');
    expect(sessionCookie.clearSessionCookie).toHaveBeenCalledTimes(1);
  });

  it('refreshes the persisted session and reissues the cookie for active requests', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
    prisma.findSessionWithUser.mockResolvedValue({
      id: 'session-1',
      expiresAt: new Date('2026-08-05T12:05:00.000Z'),
      absoluteExpiresAt: new Date('2026-08-05T18:00:00.000Z'),
      user: {
        id: 'user-1',
        username: 'operator',
        role: UserRole.OPERATOR,
        active: true,
      },
    });

    const request = {
      cookies: { 'puntored.sid': 'session-1' },
    };
    const response = {};
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as never;

    await expect(guard.canActivate(context)).resolves.toBe(true);

    const expectedExpiry = new Date('2026-08-05T12:30:00.000Z');

    expect(prisma.refreshSession).toHaveBeenCalledWith(
      'session-1',
      new Date('2026-08-05T12:00:00.000Z'),
      expectedExpiry,
    );
    expect(sessionCookie.setSessionCookie).toHaveBeenCalledWith(
      response,
      'session-1',
      expectedExpiry,
    );
    expect(request).toMatchObject({
      auth: {
        userId: 'user-1',
        username: 'operator',
        role: UserRole.OPERATOR,
        sessionId: 'session-1',
      },
    });
  });
});
