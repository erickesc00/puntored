import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { hash } from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
    },
    session: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const config = {
    session: {
      idleTtlMinutes: 30,
      absoluteTtlHours: 8,
      cookieName: 'puntored.sid',
      cookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
      },
    },
  };

  const metrics = {
    recordLoginAttempt: jest.fn(),
  };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      prisma as never,
      config as never,
      metrics as never,
    );
  });

  it('creates a persisted session and secure cookie for valid credentials', async () => {
    const passwordHash = await hash('Puntored123!', 4);
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      username: 'operator',
      role: UserRole.OPERATOR,
      active: true,
      passwordHash,
    });
    prisma.session.create.mockResolvedValue(undefined);

    const result = await service.login(
      { username: 'operator', password: 'Puntored123!' },
      '127.0.0.1',
      'jest',
    );

    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    expect(result.user).toEqual({
      id: 'user-1',
      username: 'operator',
      role: UserRole.OPERATOR,
    });
    expect(result.cookie.name).toBe('puntored.sid');
    expect(result.cookie.options.httpOnly).toBe(true);
    expect(metrics.recordLoginAttempt).toHaveBeenCalledWith('success');
  });

  it('returns a generic unauthorized error when the user does not exist', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.login({ username: 'unknown', password: 'bad-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(metrics.recordLoginAttempt).toHaveBeenCalledWith('failure');
    expect(prisma.session.create).not.toHaveBeenCalled();
  });
});
