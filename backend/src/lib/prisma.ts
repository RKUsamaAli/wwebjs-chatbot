import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'node:path';

const getDbUrl = (): string => {
  const url = process.env['DATABASE_URL'] ?? 'file:./dev.db';
  const filePath = url.startsWith('file:') ? url.slice(5) : url;
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
};

const createPrismaClient = (): PrismaClient => {
  const adapter = new PrismaBetterSqlite3({ url: `file:${getDbUrl()}` });
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
};

export const prisma = createPrismaClient();
