import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfigService } from './common/config/app-config.service';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { setupOpenApi } from './common/openapi/openapi-config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
  setupOpenApi(app, config);

  await app.listen(config.http.port);
}

void bootstrap();
