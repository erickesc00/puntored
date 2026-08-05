import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { SessionGuard } from './session.guard';

describe('SessionGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };

  const prisma = {
    session: {
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const config = {
    session: {
      cookieName: 'puntored.sid',
      idleTtlMinutes: 30,
    },
  };

  let guard: SessionGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(false);
    guard = new SessionGuard(
      reflector as unknown as Reflector,
      prisma as never,
      config as never,
    );
  });

  it('rejects expired sessions and deletes them from persistence', async () => {
    prisma.session.findUnique.mockResolvedValue({
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
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as never;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { id: 'session-1' },
    });
  });
});
