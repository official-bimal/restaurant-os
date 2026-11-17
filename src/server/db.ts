import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForDb = globalThis as unknown as { prisma?: PrismaClient };

export function createDb(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  // DB_POOL_MAX=1 is set for the embedded dev database, which serves one connection.
  const max = process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : undefined;
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) });
}

export const db = globalForDb.prisma ?? createDb();
// Kept on globalThis in production too: the bundler can give route handlers and pages their own copy of this file, and each
// copy would otherwise open its own connection pool (the embedded dev database only allows one connection).
globalForDb.prisma = db;
