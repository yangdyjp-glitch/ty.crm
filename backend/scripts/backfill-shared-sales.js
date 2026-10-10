const { PrismaClient } = require('@prisma/client');
const { normalizeCustomerName } = require('../dist/common/customer-identity');

async function backfillSharedSales(prisma) {
  return prisma.$transaction(async (tx) => {
    // Serialize the initial snapshot with the still-running previous release.
    await tx.$executeRaw`LOCK TABLE "Customer", "Order" IN SHARE ROW EXCLUSIVE MODE`;
    const customers = await tx.customer.findMany({
      select: { id: true, name: true, normalizedName: true, ownerUserId: true, enteredById: true, createdAt: true },
    });
    const validUserIds = new Set((await tx.user.findMany({ select: { id: true } })).map((u) => u.id));
    let normalized = 0;
    for (const customer of customers) {
      const normalizedName = normalizeCustomerName(customer.name);
      if (customer.normalizedName !== normalizedName) {
        await tx.customer.update({ where: { id: customer.id }, data: { normalizedName } });
        normalized++;
      }
    }
    const memberships = customers
      .filter((c) => c.ownerUserId && validUserIds.has(c.ownerUserId))
      .map((c) => ({ customerId: c.id, userId: c.ownerUserId, addedById: c.enteredById, joinedAt: c.createdAt }));
    const owners = memberships.length
      ? await tx.customerSales.createMany({ data: memberships, skipDuplicates: true })
      : { count: 0 };
    const orders = await tx.order.findMany({
      where: { salesSnapshotTaken: false },
      select: { id: true, customer: { select: { ownerUserId: true } } },
    });
    const attributions = orders
      .filter((o) => o.customer.ownerUserId && validUserIds.has(o.customer.ownerUserId))
      .map((o) => ({ orderId: o.id, userId: o.customer.ownerUserId }));
    if (attributions.length) await tx.orderSales.createMany({ data: attributions, skipDuplicates: true });
    if (orders.length) {
      await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { salesSnapshotTaken: true } });
    }
    return { normalized, memberships: owners.count, orderSnapshots: orders.length };
  }, { timeout: 120000 });
}

module.exports = { backfillSharedSales };
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const prisma = new PrismaClient();
  backfillSharedSales(prisma)
    .then((result) => console.log('Shared sales migration:', JSON.stringify(result)))
    .catch((error) => { console.error('Shared sales migration failed:', error.code || error.name); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
