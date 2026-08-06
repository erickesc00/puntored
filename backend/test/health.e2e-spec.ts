import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { PrismaService } from './../src/common/prisma/prisma.service';

describe('Health endpoints (e2e)', () => {
  const setEnv = () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3001';
    process.env.GLOBAL_PREFIX = 'api';
    process.env.APP_VERSION = '0.1.0-test';
    process.env.DATABASE_URL =
      'mysql://puntored:puntored@localhost:3306/puntored_test';
    process.env.COOKIE_SECRET = 'test-cookie-secret-1234';
  };

  const createApp = async (queryRaw: jest.Mock) => {
    setEnv();
    const { AppModule } = await import('./../src/app.module');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        $queryRaw: queryRaw,
      })
      .compile();

    const app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    return app;
  };

  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(jest.fn().mockResolvedValue([{ value: 1 }]));
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('/api/health (GET)', async () => {
    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/api/health')
      .expect(200)
      .expect((response: SupertestResponse) => {
        const body = response.body as { status: string; version: string };
        expect(body.status).toBe('ok');
        expect(body.version).toBe('0.1.0-test');
      });
  });

  it('/api/metrics (GET)', async () => {
    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/api/metrics')
      .expect(200)
      .expect((response: SupertestResponse) => {
        expect(response.text).toContain('puntored_http_requests_total');
      });
  });

  it('/api/health (GET) returns 503 when readiness check fails', async () => {
    const degradedApp = await createApp(
      jest.fn().mockRejectedValue(new Error('db down')),
    );

    await request(degradedApp.getHttpServer() as Parameters<typeof request>[0])
      .get('/api/health')
      .expect(503)
      .expect((response: SupertestResponse) => {
        const body = response.body as {
          status: string;
          checks: { database: string };
        };
        expect(body.status).toBe('degraded');
        expect(body.checks.database).toBe('down');
      });

    await degradedApp.close();
  });
});
