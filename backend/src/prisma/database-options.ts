import { Prisma } from '@prisma/client';

/** Leave room in the shared Supabase session pool for deploy overlap and maintenance. */
export function databaseOptions(databaseUrl = process.env.DATABASE_URL): Prisma.PrismaClientOptions {
  if (!databaseUrl) return {};
  const url = new URL(databaseUrl);
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '3');
  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '15');
  return { datasources: { db: { url: url.toString() } } };
}
