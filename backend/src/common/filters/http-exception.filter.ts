import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Injectable()
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const correlationId = request.correlationId ?? 'unknown';

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error' };

    const normalized = this.normalizeBody(body, status);

    response.status(status).json({
      statusCode: status,
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
  }

  private normalizeBody(
    body: string | object,
    status: number,
  ): { code: string; message: string; details?: unknown } {
    if (typeof body === 'string') {
      return {
        code: this.defaultCode(status),
        message: body,
      };
    }

    const maybeBody = body as {
      code?: string;
      message?: string | string[];
      error?: string;
    };

    const message = Array.isArray(maybeBody.message)
      ? 'Validation failed'
      : (maybeBody.message ?? maybeBody.error ?? 'Request failed');

    return {
      code: maybeBody.code ?? this.defaultCode(status),
      message,
      details: Array.isArray(maybeBody.message) ? maybeBody.message : undefined,
    };
  }

  private defaultCode(status: number) {
    if (status === 400) return 'BAD_REQUEST';
    if (status === 401) return 'UNAUTHENTICATED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
    if (status === 429) return 'RATE_LIMITED';
    return 'INTERNAL_ERROR';
  }
}
