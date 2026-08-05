import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';
import type { AppEnv } from './app-env.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<AppEnv, true>) {}

  get env() {
    return this.configService.get('NODE_ENV', { infer: true });
  }

  get isProduction() {
    return this.env === 'production';
  }

  get version() {
    return this.configService.get('APP_VERSION', { infer: true });
  }

  get http() {
    return {
      port: this.configService.get('PORT', { infer: true }),
      globalPrefix: this.configService.get('GLOBAL_PREFIX', { infer: true }),
    };
  }

  get databaseUrl() {
    return this.configService.get('DATABASE_URL', { infer: true });
  }

  get session() {
    const secure = this.configService.get('COOKIE_SECURE', { infer: true });
    const domain = this.configService.get('COOKIE_DOMAIN', { infer: true });

    return {
      cookieName: this.configService.get('COOKIE_NAME', { infer: true }),
      cookieSecret: this.configService.get('COOKIE_SECRET', { infer: true }),
      idleTtlMinutes: this.configService.get('SESSION_IDLE_TTL_MINUTES', {
        infer: true,
      }),
      absoluteTtlHours: this.configService.get('SESSION_ABSOLUTE_TTL_HOURS', {
        infer: true,
      }),
      cookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        ...(domain ? { domain } : {}),
      } satisfies CookieOptions,
    };
  }

  get security() {
    return {
      bcryptRounds: this.configService.get('BCRYPT_ROUNDS', { infer: true }),
      loginRateLimitTtlSeconds: this.configService.get(
        'LOGIN_RATE_LIMIT_TTL_SECONDS',
        {
          infer: true,
        },
      ),
      loginRateLimitLimit: this.configService.get('LOGIN_RATE_LIMIT_LIMIT', {
        infer: true,
      }),
    };
  }
}
