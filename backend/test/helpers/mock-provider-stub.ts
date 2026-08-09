import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

type ProviderRecord = {
  backendReferenceId: string;
  externalReference: string;
  concept: string;
  amount: number;
  currency: string;
  dueDate: string;
  status: 'PENDING';
  createdAt: string;
};

export class MockProviderStub {
  private readonly records = new Map<string, ProviderRecord>();
  private readonly server = createServer((request, response) => {
    void this.handleRequest(request, response);
  });
  private currentPort = 0;
  private nextAllocationFailure: {
    statusCode: number;
    body: Record<string, unknown>;
  } | null = null;

  constructor(readonly apiKey: string) {}

  get baseUrl() {
    return `http://127.0.0.1:${this.currentPort}`;
  }

  async start() {
    await new Promise<void>((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        if (!address || typeof address === 'string') {
          throw new Error('Unable to resolve mock provider stub address.');
        }

        this.currentPort = address.port;
        resolve();
      });
    });
  }

  async stop() {
    if (!this.server.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  reset() {
    this.records.clear();
    this.nextAllocationFailure = null;
  }

  failNextAllocation(statusCode: number, body: Record<string, unknown>) {
    this.nextAllocationFailure = { statusCode, body };
  }

  listRecords() {
    return [...this.records.values()];
  }

  getRecord(backendReferenceId: string) {
    return this.records.get(backendReferenceId) ?? null;
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    if (request.headers['x-stub-api-key'] !== this.apiKey) {
      this.writeJson(response, 401, {
        code: 'STUB_UNAUTHORIZED',
        message: 'Stub API authentication failed',
      });
      return;
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (request.method === 'POST' && url.pathname === '/external-references') {
      if (this.nextAllocationFailure) {
        const failure = this.nextAllocationFailure;
        this.nextAllocationFailure = null;
        this.writeJson(response, failure.statusCode, failure.body);
        return;
      }

      const body = (await this.readJsonBody(request)) as {
        backendReferenceId: string;
        concept: string;
        amount: number;
        currency: string;
        dueDate: string;
      };
      const existing = this.records.get(body.backendReferenceId);

      if (existing) {
        this.writeJson(response, 200, existing);
        return;
      }

      const record: ProviderRecord = {
        backendReferenceId: body.backendReferenceId,
        externalReference: `EXT-MOCK-${String(this.records.size + 1).padStart(3, '0')}`,
        concept: body.concept,
        amount: body.amount,
        currency: body.currency,
        dueDate: body.dueDate,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      this.records.set(record.backendReferenceId, record);
      this.writeJson(response, 200, record);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/external-references') {
      const backendReferenceId = url.searchParams.get('backendReferenceId');
      const items = backendReferenceId
        ? this.listRecords().filter(
            (item) => item.backendReferenceId === backendReferenceId,
          )
        : this.listRecords();

      this.writeJson(response, 200, { items });
      return;
    }

    this.writeJson(response, 404, {
      code: 'UNKNOWN_ROUTE',
      message: `Unhandled stub path: ${url.pathname}`,
    });
  }

  private readJsonBody(request: IncomingMessage) {
    return new Promise<unknown>((resolve, reject) => {
      const chunks: Buffer[] = [];

      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text.length > 0 ? JSON.parse(text) : null);
      });
      request.on('error', reject);
    });
  }

  private writeJson(
    response: ServerResponse,
    statusCode: number,
    body: Record<string, unknown>,
  ) {
    response.statusCode = statusCode;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(body));
  }
}
