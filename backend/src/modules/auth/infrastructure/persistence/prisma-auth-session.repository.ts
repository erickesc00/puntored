import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type {
  AuthActiveUser,
  AuthSessionRepository,
  PersistedSession,
  SessionWithUser,
} from '../../application/ports/session.repository';

@Injectable()
export class PrismaAuthSessionRepository implements AuthSessionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  findActiveUserByLogin(login: string): Promise<AuthActiveUser | null> {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ username: login }, { email: login }],
        active: true,
      },
      select: {
        id: true,
        username: true,
        role: true,
        passwordHash: true,
      },
    });
  }

  async createSession(input: {
    userId: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<PersistedSession> {
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.session.idleTtlMinutes * 60 * 1000,
    );
    const absoluteExpiresAt = new Date(
      now.getTime() + this.config.session.absoluteTtlHours * 60 * 60 * 1000,
    );
    const id = randomUUID();

    await this.prisma.session.create({
      data: {
        id,
        userId: input.userId,
        expiresAt,
        absoluteExpiresAt,
        lastSeenAt: now,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });

    return {
      id,
      expiresAt,
      absoluteExpiresAt,
    };
  }

  findSessionWithUser(sessionId: string): Promise<SessionWithUser | null> {
    return this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            role: true,
            active: true,
          },
        },
      },
    });
  }

  async refreshSession(sessionId: string, now: Date, expiresAt: Date) {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        lastSeenAt: now,
        expiresAt,
      },
    });
  }

  async deleteSession(sessionId: string) {
    await this.prisma.session.deleteMany({
      where: { id: sessionId },
    });
  }
}
