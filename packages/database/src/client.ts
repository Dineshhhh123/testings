import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

// Explicitly pass DATABASE_URL so Prisma never fails with "Environment variable not found"
// even if dotenv hasn't loaded yet. The fallback matches the standard local dev setup.
const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/abc_platform';

export const prisma: PrismaClient =
  global.__prismaClient ??
  new PrismaClient({
    log: ['error', 'warn'],
    datasources: {
      db: { url: DATABASE_URL }
    }
  });

if (process.env['NODE_ENV'] !== 'production') {
  global.__prismaClient = prisma;
}


