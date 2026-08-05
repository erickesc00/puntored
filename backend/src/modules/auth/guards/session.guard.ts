import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

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
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
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
    const sessionId = request.cookies?.[this.config.session.cookieName] as
      string | undefined;

    if (!sessionId) {
      throw new UnauthorizedException({
        code: 'SESSION_REQUIRED',
        message: 'Authentication required',
      });
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session || !session.user.active) {
      throw new UnauthorizedException({
        code: 'SESSION_REQUIRED',
        message: 'Authentication required',
      });
    }

    const now = new Date();
    if (session.expiresAt <= now || session.absoluteExpiresAt <= now) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      throw new UnauthorizedException({
        code: 'SESSION_EXPIRED',
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

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        expiresAt,
      },
    });

    request.auth = {
      userId: session.user.id,
      username: session.user.username,
      role: session.user.role,
      sessionId: session.id,
    };

    return true;
  }
}
