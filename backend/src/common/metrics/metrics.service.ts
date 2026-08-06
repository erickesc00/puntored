import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly httpRequests = new Counter({
    name: 'puntored_http_requests_total',
    help: 'Total HTTP requests handled by the API',
    labelNames: ['method', 'route', 'status_code'],
    registers: [this.registry],
  });

  private readonly httpErrors = new Counter({
    name: 'puntored_http_errors_total',
    help: 'Total HTTP error responses emitted by the API',
    labelNames: ['method', 'route', 'status_code'],
    registers: [this.registry],
  });

  private readonly httpLatency = new Histogram({
    name: 'puntored_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  private readonly authLogins = new Counter({
    name: 'puntored_auth_login_attempts_total',
    help: 'Authentication login attempts by outcome',
    labelNames: ['outcome'],
    registers: [this.registry],
  });

  private readonly providerEvents = new Counter({
    name: 'puntored_provider_events_total',
    help: 'Provider callback events handled by outcome',
    labelNames: ['event_type', 'outcome'],
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({ service: 'puntored-backend' });
    collectDefaultMetrics({ register: this.registry, prefix: 'puntored_' });
  }

  observeHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ) {
    const labels = {
      method,
      route,
      status_code: String(statusCode),
    };

    this.httpRequests.inc(labels);
    this.httpLatency.observe(labels, durationSeconds);

    if (statusCode >= 400) {
      this.httpErrors.inc(labels);
    }
  }

  recordLoginAttempt(outcome: 'success' | 'failure') {
    this.authLogins.inc({ outcome });
  }

  recordProviderEvent(eventType: string, outcome: string) {
    this.providerEvents.inc({ event_type: eventType, outcome });
  }

  async getMetrics() {
    return this.registry.metrics();
  }
}
