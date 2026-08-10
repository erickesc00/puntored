import { Module } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service';
import { MetricsModule } from '../../common/metrics/metrics.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_METRICS_PORT } from './application/ports/auth-metrics.port';
import { AUTH_SESSION_REPOSITORY } from './application/ports/session.repository';
import { SESSION_COOKIE_PORT } from './application/ports/session-cookie.port';
import { GetCurrentSessionUseCase } from './application/use-cases/get-current-session.use-case';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { RoleGuard } from './guards/role.guard';
import { SessionGuard } from './guards/session.guard';
import { AuthMetricsAdapter } from './infrastructure/adapters/auth-metrics.adapter';
import { SessionCookieAdapter } from './infrastructure/adapters/session-cookie.adapter';
import { PrismaAuthSessionRepository } from './infrastructure/persistence/prisma-auth-session.repository';

@Module({
  imports: [MetricsModule],
  controllers: [AuthController],
  providers: [
    AppConfigService,
    AuthService,
    SessionGuard,
    RoleGuard,
    LoginUseCase,
    LogoutUseCase,
    GetCurrentSessionUseCase,
    PrismaAuthSessionRepository,
    SessionCookieAdapter,
    AuthMetricsAdapter,
    {
      provide: AUTH_SESSION_REPOSITORY,
      useExisting: PrismaAuthSessionRepository,
    },
    {
      provide: SESSION_COOKIE_PORT,
      useExisting: SessionCookieAdapter,
    },
    {
      provide: AUTH_METRICS_PORT,
      useExisting: AuthMetricsAdapter,
    },
  ],
  exports: [
    AppConfigService,
    AuthService,
    SessionGuard,
    RoleGuard,
    AUTH_SESSION_REPOSITORY,
    SESSION_COOKIE_PORT,
  ],
})
export class AuthModule {}
