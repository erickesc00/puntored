import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { appEnvSchema } from './common/config/app-env.schema';
import { AppConfigService } from './common/config/app-config.service';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { MetricsModule } from './common/metrics/metrics.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ProviderEventsModule } from './modules/provider-events/provider-events.module';
import { ReferenceExpirationModule } from './modules/references/reference-expiration.module';
import { ReferencesModule } from './modules/references/references.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config: Record<string, unknown>) => appEnvSchema.parse(config),
      envFilePath: ['.env.local', '.env'],
      expandVariables: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    MetricsModule,
    AuthModule,
    HealthModule,
    ProviderEventsModule,
    ReferenceExpirationModule,
    ReferencesModule,
  ],
  providers: [
    AppConfigService,
    HttpExceptionFilter,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
  ],
})
export class AppModule {}
