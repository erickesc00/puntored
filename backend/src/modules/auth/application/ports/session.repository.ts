import type { UserRole } from '@prisma/client';

export const AUTH_SESSION_REPOSITORY = Symbol('AUTH_SESSION_REPOSITORY');

export interface AuthActiveUser {
  id: string;
  username: string;
  role: UserRole;
  passwordHash: string;
}

export interface PersistedSession {
  id: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface SessionWithUser extends PersistedSession {
  user: {
    id: string;
    username: string;
    role: UserRole;
    active: boolean;
  };
}

export interface AuthSessionRepository {
  findActiveUserByLogin(login: string): Promise<AuthActiveUser | null>;
  createSession(input: {
    userId: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<PersistedSession>;
  findSessionWithUser(sessionId: string): Promise<SessionWithUser | null>;
  refreshSession(sessionId: string, now: Date, expiresAt: Date): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}
