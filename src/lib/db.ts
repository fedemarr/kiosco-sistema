import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { postgresConfig } from './postgres';
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db =
  globalDb.prisma ??
  new PrismaClient({
    adapter: new PrismaPg(postgresConfig()),
  });
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
