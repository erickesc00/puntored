import cookieParser from 'cookie-parser';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { hash } from 'bcrypt';
import request from 'supertest';
import { PrismaService } from './../src/common/prisma/prisma.service';

describe('Auth endpoints (e2e)', () => {
  let app: INestApplication;
  let passwordHash: string;

  const prisma = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    user: {
      findFirst: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3002';
    process.env.GLOBAL_PREFIX = 'api';
    process.env.APP_VERSION = '0.1.0-test';
    process.env.DATABASE_URL =
      'mysql://puntored:puntored@localhost:3306/puntored_test';
    process.env.COOKIE_SECRET = 'test-cookie-secret-1234';

    passwordHash = await hash('Puntored123!', 4);

    const { AppModule } = await import('./../src/app.module');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser(process.env.COOKIE_SECRET));
    app.setGlobalPrefix('api');
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      username: 'operator',
      email: 'operator@puntored.test',
      role: UserRole.OPERATOR,
      active: true,
      passwordHash,
    });
    prisma.session.create.mockResolvedValue(undefined);
    prisma.session.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          absoluteExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
          user: {
            id: 'user-1',
            username: 'operator',
            role: UserRole.OPERATOR,
            active: true,
          },
        }),
    );
    prisma.session.update.mockResolvedValue(undefined);
    prisma.session.deleteMany.mockResolvedValue({ count: 1 });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('issues a session cookie on login, refreshes it on /me, and clears it on logout', async () => {
    const loginResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/auth/login')
      .send({ username: 'operator', password: 'Puntored123!' })
      .expect(200);

    const loginCookie = loginResponse.headers['set-cookie']?.[0];
    const sessionCreateCall = prisma.session.create.mock.calls[0] as
      [{ data: { id: string } }] | undefined;
    const createdSessionId = sessionCreateCall?.[0].data.id as string;

    expect(loginCookie).toBeDefined();
    expect(createdSessionId).toBeTruthy();

    expect(loginCookie).toContain(`puntored.sid=${createdSessionId}`);
    expect(loginCookie).toContain('HttpOnly');

    const sessionCookie = loginCookie as string;

    const meResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/api/auth/me')
      .set('Cookie', sessionCookie)
      .expect(200);

    expect(meResponse.body).toMatchObject({
      user: {
        userId: 'user-1',
        username: 'operator',
        role: UserRole.OPERATOR,
      },
    });
    expect(meResponse.headers['set-cookie']?.[0]).toContain(
      `puntored.sid=${createdSessionId}`,
    );

    const logoutResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/auth/logout')
      .set('Cookie', sessionCookie)
      .expect(204);

    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { id: createdSessionId },
    });
    const logoutCookies = logoutResponse.headers['set-cookie'] as
      string[] | undefined;

    expect(
      logoutCookies?.some((cookie) => cookie.includes('puntored.sid=;')),
    ).toBe(true);
  });
});
