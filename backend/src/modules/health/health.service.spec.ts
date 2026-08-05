import { HealthService } from './health.service';

describe('HealthService', () => {
  const prisma = {
    $queryRaw: jest.fn(),
  };

  const config = {
    version: '0.1.0',
  };

  let service: HealthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HealthService(prisma as never, config as never);
  });

  it('returns ok when the database ping succeeds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ value: 1 }]);

    await expect(service.getHealth()).resolves.toMatchObject({
      status: 'ok',
      version: '0.1.0',
      checks: { database: 'up' },
    });
  });
});
