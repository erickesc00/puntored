import { hash } from 'bcrypt';
import {
  PrismaClient,
  Prisma,
  ReferenceStatus,
  UserRole,
  type User,
} from '@prisma/client';

const prisma = new PrismaClient();

export const DEMO_PASSWORD = 'Puntored123!';

type SeedHistoryEvent = {
  actorType: 'USER' | 'SYSTEM' | 'PROVIDER';
  actor: string;
  action: string;
  result: string;
  metadataJson?: Prisma.InputJsonValue;
};

type DemoReferenceFixture = {
  externalReference: string;
  concept: string;
  amount: number;
  currency: string;
  dueAt: string;
  status: ReferenceStatus;
  history: SeedHistoryEvent[];
  providerEventId?: string;
};

export const DEMO_REFERENCE_FIXTURES: DemoReferenceFixture[] = [
  {
    externalReference: 'DEMO-CANCELLED-001',
    concept: 'Cancelled insurance installment',
    amount: 210500,
    currency: 'COP',
    dueAt: '2099-12-15T12:00:00.000Z',
    status: ReferenceStatus.CANCELLED,
    history: [
      {
        actorType: 'USER' as const,
        actor: 'operator' as const,
        action: 'CREATE_REFERENCE',
        result: 'SUCCESS',
      },
      {
        actorType: 'USER' as const,
        actor: 'supervisor' as const,
        action: 'CANCEL_ATTEMPT',
        result: 'STARTED',
      },
      {
        actorType: 'USER' as const,
        actor: 'supervisor' as const,
        action: 'CANCEL_REFERENCE',
        result: 'SUCCESS',
      },
    ],
  },
  {
    externalReference: 'DEMO-EXPIRED-001',
    concept: 'Expired telecom bill',
    amount: 76000,
    currency: 'COP',
    dueAt: '2025-01-10T12:00:00.000Z',
    status: ReferenceStatus.EXPIRED,
    history: [
      {
        actorType: 'USER' as const,
        actor: 'operator' as const,
        action: 'CREATE_REFERENCE',
        result: 'SUCCESS',
      },
      {
        actorType: 'SYSTEM' as const,
        actor: 'seed:system',
        action: 'EXPIRE_REFERENCE',
        result: 'SUCCESS',
      },
    ],
  },
  {
    externalReference: 'DEMO-PAID-001',
    concept: 'Paid school fee',
    amount: 98000,
    currency: 'COP',
    dueAt: '2099-12-20T12:00:00.000Z',
    status: ReferenceStatus.PAID,
    providerEventId: 'demo-provider-paid-001',
    history: [
      {
        actorType: 'USER' as const,
        actor: 'operator' as const,
        action: 'CREATE_REFERENCE',
        result: 'SUCCESS',
      },
      {
        actorType: 'PROVIDER' as const,
        actor: 'provider:puntored',
        action: 'PROVIDER_EVENT',
        result: 'SUCCESS',
        metadataJson: { externalReference: 'DEMO-PAID-001', status: 'PAID' },
      },
    ],
  },
  {
    externalReference: 'DEMO-PENDING-001',
    concept: 'Pending utility payment',
    amount: 125000,
    currency: 'COP',
    dueAt: '2099-12-31T12:00:00.000Z',
    status: ReferenceStatus.PENDING,
    history: [
      {
        actorType: 'USER' as const,
        actor: 'operator' as const,
        action: 'CREATE_REFERENCE',
        result: 'SUCCESS',
        metadataJson: { source: 'seed', note: 'Pending demo fixture' },
      },
    ],
  },
];

type SeedUsers = {
  operator: User;
  supervisor: User;
};

type SeedPrismaClient = PrismaClient | Prisma.TransactionClient;

async function upsertDemoReference(
  client: SeedPrismaClient,
  fixture: DemoReferenceFixture,
  users: SeedUsers,
) {
  const reference = await client.paymentReference.upsert({
    where: { externalReference: fixture.externalReference },
    update: {
      concept: fixture.concept,
      amount: BigInt(fixture.amount),
      currency: fixture.currency,
      dueAt: new Date(fixture.dueAt),
      status: fixture.status,
      version: fixture.history.length,
      createdBy: users.operator.id,
    },
    create: {
      externalReference: fixture.externalReference,
      concept: fixture.concept,
      amount: BigInt(fixture.amount),
      currency: fixture.currency,
      dueAt: new Date(fixture.dueAt),
      status: fixture.status,
      version: fixture.history.length,
      createdBy: users.operator.id,
    },
  });

  await client.auditEvent.deleteMany({ where: { referenceId: reference.id } });
  await client.providerEvent.deleteMany({
    where: { referenceId: reference.id },
  });

  await client.auditEvent.createMany({
    data: fixture.history.map((event) => ({
      referenceId: reference.id,
      actorType: event.actorType,
      actorId:
        event.actor === 'operator'
          ? users.operator.id
          : event.actor === 'supervisor'
            ? users.supervisor.id
            : event.actor,
      action: event.action,
      result: event.result,
      metadataJson: event.metadataJson,
    })),
  });

  if (fixture.providerEventId) {
    await client.providerEvent.create({
      data: {
        providerEventId: fixture.providerEventId,
        referenceId: reference.id,
        externalReference: fixture.externalReference,
        payloadHash: fixture.providerEventId.padEnd(64, '0').slice(0, 64),
        eventType: 'PAID',
        outcome: 'SUCCESS',
      },
    });
  }

  return reference;
}

export async function seedUsers(
  client: SeedPrismaClient,
  options?: { bcryptRounds?: number },
): Promise<SeedUsers> {
  const passwordHash = await hash(DEMO_PASSWORD, options?.bcryptRounds ?? 10);

  const upsertUser = async (
    username: 'operator' | 'supervisor',
    email: string,
    role: UserRole,
  ) => {
    try {
      return await client.user.upsert({
        where: { username },
        update: {
          email,
          passwordHash,
          role,
          active: true,
        },
        create: {
          username,
          email,
          passwordHash,
          role,
          active: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return client.user.update({
          where: { username },
          data: {
            email,
            passwordHash,
            role,
            active: true,
          },
        });
      }

      throw error;
    }
  };

  const operator = await upsertUser(
    'operator',
    'operator@puntored.local',
    UserRole.OPERATOR,
  );
  const supervisor = await upsertUser(
    'supervisor',
    'supervisor@puntored.local',
    UserRole.SUPERVISOR,
  );

  return { operator, supervisor };
}

export async function seedDemoReferences(
  client: SeedPrismaClient,
  users: SeedUsers,
) {
  const references = [];

  for (const fixture of DEMO_REFERENCE_FIXTURES) {
    references.push(await upsertDemoReference(client, fixture, users));
  }

  return references;
}

export async function seedDatabase(
  client: SeedPrismaClient,
  options?: { bcryptRounds?: number },
) {
  const users = await seedUsers(client, options);
  const references = await seedDemoReferences(client, users);

  return { users, references };
}

async function main() {
  await seedDatabase(prisma);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
