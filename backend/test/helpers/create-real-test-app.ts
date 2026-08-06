import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppConfigService } from '../../src/common/config/app-config.service';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { CorrelationIdMiddleware } from '../../src/common/middleware/correlation-id.middleware';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { applyTestEnvironment, ensureTestDatabaseReady } from './mysql-test-db';

export async function createRealTestApp() {
  applyTestEnvironment();
  await ensureTestDatabaseReady();

  const { AppModule } = await import('../../src/app.module');
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  const config = app.get(AppConfigService);
  const correlationIdMiddleware = new CorrelationIdMiddleware();

  app.use((request: Request, response: Response, next: NextFunction) =>
    correlationIdMiddleware.use(request, response, next),
  );
  app.use(cookieParser(config.session.cookieSecret));
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(app.get(HttpExceptionFilter));
  app.enableShutdownHooks();
  app.setGlobalPrefix(config.http.globalPrefix);

  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
  };
}
