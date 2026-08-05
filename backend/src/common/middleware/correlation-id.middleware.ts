import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export class CorrelationIdMiddleware {
  use(request: Request, response: Response, next: NextFunction) {
    const incomingId = request.header('x-correlation-id');
    const correlationId = incomingId?.trim() || randomUUID();

    request.correlationId = correlationId;
    response.setHeader('x-correlation-id', correlationId);

    next();
  }
}
