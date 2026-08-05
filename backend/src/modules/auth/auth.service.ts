import { Injectable, UnauthorizedException } from '@nestjs/common';
import { compare } from 'bcrypt';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { AppConfigService } from '../../common/config/app-config.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly metricsService: MetricsService,
  ) {}

  async login(credentials: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: credentials.username },
          { email: credentials.username },
        ],
        active: true,
      },
    });

    if (!user) {
      this.metricsService.recordLoginAttempt('failure');
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    const passwordMatches = await compare(
      credentials.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      this.metricsService.recordLoginAttempt('failure');
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.session.idleTtlMinutes * 60 * 1000,
    );
    const absoluteExpiresAt = new Date(
      now.getTime() + this.config.session.absoluteTtlHours * 60 * 60 * 1000,
    );
    const sessionId = randomUUID();

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        expiresAt,
        absoluteExpiresAt,
        lastSeenAt: now,
        ipAddress,
        userAgent,
      },
    });

    this.metricsService.recordLoginAttempt('success');

    return {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      session: {
        id: sessionId,
        expiresAt,
        absoluteExpiresAt,
      },
      cookie: {
        name: this.config.session.cookieName,
        value: sessionId,
        options: {
          ...this.config.session.cookieOptions,
          expires: expiresAt,
        },
      },
    };
  }

  async logout(sessionId: string | null) {
    if (!sessionId) {
      return;
    }

    await this.prisma.session.deleteMany({
      where: { id: sessionId },
    });
  }

  clearSessionCookie(response: Response) {
    response.clearCookie(
      this.config.session.cookieName,
      this.config.session.cookieOptions,
    );
  }

  canCancel(role: UserRole) {
    return role === UserRole.SUPERVISOR;
  }
}
