import { UserRole } from '@prisma/client';
import { hash } from 'bcrypt';
import { ApplicationHttpError } from '../../../../common/errors/application-http.error';
import { ERROR_CODE } from '../../../../shared/vocabulary/error-codes';
import { AUTH_LOGIN_OUTCOME } from '../../../../shared/vocabulary/auth-login-outcomes';
import type { AuthMetricsPort } from '../ports/auth-metrics.port';
import type { SessionCookiePort } from '../ports/session-cookie.port';
import type { AuthSessionRepository } from '../ports/session.repository';
import { LoginUseCase } from './login.use-case';

describe('LoginUseCase', () => {
  const repository: Pick<
    jest.Mocked<AuthSessionRepository>,
    | 'findActiveUserByLogin'
    | 'createSession'
    | 'findSessionWithUser'
    | 'refreshSession'
    | 'deleteSession'
  > = {
    findActiveUserByLogin: jest.fn(),
    createSession: jest.fn(),
    findSessionWithUser: jest.fn(),
    refreshSession: jest.fn(),
    deleteSession: jest.fn(),
  };

  const sessionCookie: Pick<
    jest.Mocked<SessionCookiePort>,
    'buildSessionCookie' | 'setSessionCookie' | 'clearSessionCookie'
  > = {
    buildSessionCookie: jest.fn(),
    setSessionCookie: jest.fn(),
    clearSessionCookie: jest.fn(),
  };

  const metrics: jest.Mocked<AuthMetricsPort> = {
    recordLoginAttempt: jest.fn(),
  };

  let useCase: LoginUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new LoginUseCase(repository, sessionCookie, metrics);
  });

  it('creates a persisted session and cookie for valid credentials', async () => {
    const expiresAt = new Date('2026-08-09T12:30:00.000Z');
    const absoluteExpiresAt = new Date('2026-08-09T20:00:00.000Z');
    const passwordHash = await hash('Puntored123!', 4);

    repository.findActiveUserByLogin.mockResolvedValue({
      id: 'user-1',
      username: 'operator',
      role: UserRole.OPERATOR,
      passwordHash,
    });
    repository.createSession.mockResolvedValue({
      id: 'session-1',
      expiresAt,
      absoluteExpiresAt,
    });
    sessionCookie.buildSessionCookie.mockReturnValue({
      name: 'puntored.sid',
      value: 'session-1',
      options: {
        httpOnly: true,
        expires: expiresAt,
      },
    });

    const result = await useCase.execute(
      { username: 'operator', password: 'Puntored123!' },
      '127.0.0.1',
      'jest',
    );

    expect(repository.createSession).toHaveBeenCalledWith({
      userId: 'user-1',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });
    expect(sessionCookie.buildSessionCookie.mock.calls[0]).toEqual([
      'session-1',
      expiresAt,
    ]);
    expect(result.user).toEqual({
      id: 'user-1',
      username: 'operator',
      role: UserRole.OPERATOR,
    });
    expect(result.session).toEqual({
      id: 'session-1',
      expiresAt,
      absoluteExpiresAt,
    });
    expect(metrics.recordLoginAttempt.mock.calls[0]).toEqual([
      AUTH_LOGIN_OUTCOME.SUCCESS,
    ]);
  });

  it('returns a generic unauthorized error when the user does not exist', async () => {
    repository.findActiveUserByLogin.mockResolvedValue(null);
    const pendingResult = useCase.execute({
      username: 'unknown',
      password: 'bad-password',
    });

    await expect(pendingResult).rejects.toBeInstanceOf(ApplicationHttpError);

    await expect(pendingResult).rejects.toMatchObject({
      statusCode: 401,
      code: ERROR_CODE.INVALID_CREDENTIALS,
      message: 'Invalid credentials',
    });

    expect(metrics.recordLoginAttempt.mock.calls[0]).toEqual([
      AUTH_LOGIN_OUTCOME.FAILURE,
    ]);
    expect(repository.createSession).not.toHaveBeenCalled();
  });
});
