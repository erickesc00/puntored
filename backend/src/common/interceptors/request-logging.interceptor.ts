import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const start = performance.now();

    const buildLogPayload = (statusCode: number) => {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;

      return {
        level: statusCode >= 500 ? 'error' : 'info',
        event: 'http_request',
        method: request.method,
        path: request.originalUrl,
        statusCode,
        durationMs,
        correlationId: request.correlationId,
        userId: request.auth?.userId ?? null,
      };
    };

    const log = (statusCode: number) => {
      const payload = buildLogPayload(statusCode);

      this.metricsService.observeHttpRequest(
        request.method,
        request.path,
        statusCode,
        payload.durationMs / 1000,
      );
      console.log(JSON.stringify(payload));
    };

    return next.handle().pipe(
      tap({
        next: () => log(response.statusCode),
        error: () => log(response.statusCode || 500),
      }),
    );
  }
}
