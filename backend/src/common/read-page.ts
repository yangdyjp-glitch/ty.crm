import { Prisma, PrismaClient } from '@prisma/client';

/** Full lists already contain their total; avoid COUNT and a read transaction. */
export async function readPage<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  all: boolean,
  rows: Prisma.PrismaPromise<T[]>,
  count: () => Prisma.PrismaPromise<number>,
): Promise<[T[], number]> {
  if (all) {
    const items = await rows;
    return [items, items.length];
  }
  return prisma.$transaction([rows, count()]);
}
