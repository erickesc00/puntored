import { hash } from 'bcrypt';
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hash('Puntored123!', 10);

  await prisma.user.upsert({
    where: { username: 'operator' },
    update: {
      email: 'operator@puntored.local',
      passwordHash,
      role: UserRole.OPERATOR,
      active: true,
    },
    create: {
      username: 'operator',
      email: 'operator@puntored.local',
      passwordHash,
      role: UserRole.OPERATOR,
      active: true,
    },
  });

  await prisma.user.upsert({
    where: { username: 'supervisor' },
    update: {
      email: 'supervisor@puntored.local',
      passwordHash,
      role: UserRole.SUPERVISOR,
      active: true,
    },
    create: {
      username: 'supervisor',
      email: 'supervisor@puntored.local',
      passwordHash,
      role: UserRole.SUPERVISOR,
      active: true,
    },
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
