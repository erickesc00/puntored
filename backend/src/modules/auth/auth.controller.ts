import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  SESSION_COOKIE_PORT,
  type SessionCookiePort,
} from './application/ports/session-cookie.port';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { SessionAuth, SessionGuard } from './guards/session.guard';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(SESSION_COOKIE_PORT)
    private readonly sessionCookie: SessionCookiePort,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(
      body,
      request.ip,
      request.headers['user-agent'],
    );

    response.cookie(
      session.cookie.name,
      session.cookie.value,
      session.cookie.options,
    );

    return {
      user: session.user,
      session: {
        expiresAt: session.session.expiresAt,
        absoluteExpiresAt: session.session.absoluteExpiresAt,
      },
    };
  }

  @UseGuards(SessionGuard)
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(request.auth?.sessionId ?? null);
    this.sessionCookie.clearSessionCookie(response);
  }

  @UseGuards(SessionGuard)
  @Get('me')
  getCurrentSession(@CurrentUser() user: SessionAuth) {
    return this.authService.getCurrentSession(user);
  }
}
