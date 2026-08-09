import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import mysql from 'mysql2/promise';
import { DEMO_PASSWORD, seedUsers } from '../../prisma/seed';

const backendRoot = resolve(__dirname, '..', '..');
const TEST_DATABASE_NAME = `puntored_test_${process.pid}`;

export const TEST_DATABASE_URL_DEFAULT = `mysql://puntored:puntored@127.0.0.1:33060/${TEST_DATABASE_NAME}`;
export const TEST_DATABASE_ADMIN_URL_DEFAULT =
  'mysql://root:root@127.0.0.1:33060/mysql';
export const TEST_PASSWORD = DEMO_PASSWORD;

let databasePrepared = false;
let preparedDatabaseUrl: string | null = null;

function getTestDatabaseUrl() {
  return process.env.TEST_DATABASE_URL ?? TEST_DATABASE_URL_DEFAULT;
}

function getTestDatabaseAdminUrl() {
  return process.env.TEST_DATABASE_ADMIN_URL ?? TEST_DATABASE_ADMIN_URL_DEFAULT;
}

function escapeIdentifier(value: string) {
  return value.replaceAll('`', '``');
}

function escapeString(value: string) {
  return value.replaceAll("'", "''");
}

function getPrismaCliBinary() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function runPrismaMigrateDeploy() {
  try {
    execFileSync(getPrismaCliBinary(), ['prisma', 'migrate', 'deploy'], {
      cwd: backendRoot,
      env: {
        ...process.env,
        DATABASE_URL: getTestDatabaseUrl(),
      },
      stdio: 'pipe',
    });
  } catch (error) {
    const typedError = error as {
      stdout?: Buffer;
      stderr?: Buffer;
      message?: string;
    };

    const stdout = typedError.stdout?.toString('utf8').trim();
    const stderr = typedError.stderr?.toString('utf8').trim();

    throw new Error(
      [
        'Failed to apply Prisma migrations for the MySQL test database.',
        stdout,
        stderr,
        typedError.message,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

async function createDatabaseAndGrantAccess() {
  const databaseUrl = new URL(getTestDatabaseUrl());
  const adminUrl = getTestDatabaseAdminUrl();
  const databaseName = databaseUrl.pathname.replace(/^\//, '');
  const appUser = decodeURIComponent(databaseUrl.username);

  if (!databaseName) {
    throw new Error('TEST_DATABASE_URL must include a database name.');
  }

  const connection = await mysql.createConnection(adminUrl);

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${escapeIdentifier(databaseName)}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    if (appUser) {
      await connection.query(
        `GRANT ALL PRIVILEGES ON \`${escapeIdentifier(databaseName)}\`.* TO '${escapeString(appUser)}'@'%'`,
      );
      await connection.query('FLUSH PRIVILEGES');
    }
  } catch (error) {
    const typedError = error as { message?: string };

    throw new Error(
      `Unable to prepare MySQL test database ${databaseName}. ${typedError.message ?? ''}`.trim(),
    );
  } finally {
    await connection.end();
  }
}

export function applyTestEnvironment() {
  process.env.NODE_ENV = 'test';
  process.env.PORT = process.env.PORT ?? '3002';
  process.env.GLOBAL_PREFIX = process.env.GLOBAL_PREFIX ?? 'api';
  process.env.APP_VERSION = process.env.APP_VERSION ?? '0.1.0-test';
  process.env.DATABASE_URL = getTestDatabaseUrl();
  process.env.COOKIE_SECRET =
    process.env.COOKIE_SECRET ?? 'test-cookie-secret-1234';
  process.env.COOKIE_SECURE = process.env.COOKIE_SECURE ?? 'false';
  process.env.LOGIN_RATE_LIMIT_LIMIT =
    process.env.LOGIN_RATE_LIMIT_LIMIT ?? '1000';
  process.env.PROVIDER_ALLOCATION_ENABLED =
    process.env.PROVIDER_ALLOCATION_ENABLED ?? 'true';
  process.env.PROVIDER_STUB_BASE_URL =
    process.env.PROVIDER_STUB_BASE_URL ?? 'http://127.0.0.1:3009';
  process.env.PROVIDER_STUB_API_KEY =
    process.env.PROVIDER_STUB_API_KEY ?? 'test-stub-api-key';
  process.env.PROVIDER_CALLBACK_BASE_URL =
    process.env.PROVIDER_CALLBACK_BASE_URL ?? 'http://127.0.0.1:3000';
  process.env.PROVIDER_ALLOCATION_TIMEOUT_MS =
    process.env.PROVIDER_ALLOCATION_TIMEOUT_MS ?? '3000';
  process.env.PROVIDER_SHARED_SECRET =
    process.env.PROVIDER_SHARED_SECRET ?? 'test-provider-secret-1234';
  process.env.PROVIDER_ACTOR_ID =
    process.env.PROVIDER_ACTOR_ID ?? 'provider:test';
}

export async function ensureTestDatabaseReady() {
  applyTestEnvironment();

  const databaseUrl = getTestDatabaseUrl();

  if (databasePrepared && preparedDatabaseUrl === databaseUrl) {
    return;
  }

  await createDatabaseAndGrantAccess();
  runPrismaMigrateDeploy();

  const prisma = new PrismaClient();
  await prisma.$connect();

  try {
    await seedBaseUsers(prisma);
  } finally {
    await prisma.$disconnect();
  }

  databasePrepared = true;
  preparedDatabaseUrl = databaseUrl;
}

export async function seedBaseUsers(prisma: PrismaClient) {
  await seedUsers(prisma, { bcryptRounds: 4 });
}

export async function resetTestDatabase(prisma: PrismaClient) {
  const connection = await mysql.createConnection(getTestDatabaseUrl());

  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query('TRUNCATE TABLE `audit_events`');
    await connection.query('TRUNCATE TABLE `idempotency_keys`');
    await connection.query('TRUNCATE TABLE `provider_events`');
    await connection.query('TRUNCATE TABLE `payment_references`');
    await connection.query('TRUNCATE TABLE `sessions`');
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await connection.end();
  }

  await seedBaseUsers(prisma);
}

export async function getSeedUsers(prisma: PrismaClient) {
  const [operator, supervisor] = await Promise.all([
    prisma.user.findUnique({ where: { username: 'operator' } }),
    prisma.user.findUnique({ where: { username: 'supervisor' } }),
  ]);

  if (!operator || !supervisor) {
    throw new Error('Expected seeded operator and supervisor users to exist.');
  }

  return {
    operator,
    supervisor,
  };
}
