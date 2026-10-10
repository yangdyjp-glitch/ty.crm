const { PrismaClient } = require('@prisma/client');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { normalizeCustomerName } = require('../dist/common/customer-identity');

async function businessSnapshot(db) {
  const customers = await db.customer.findMany({ orderBy: { id: 'asc' }, select: {
    id: true, name: true, ownerUserId: true, enteredById: true,
  } });
  const orders = await db.order.findMany({ orderBy: { id: 'asc' }, select: {
    id: true, orderNo: true, customerId: true, currency: true, originalPrice: true,
    discountAmount: true, receivableAmount: true, paidAmount: true, unpaidAmount: true, refundAmount: true,
  } });
  const financial = { orders };
  for (const model of ['payment', 'refund', 'commission', 'channelLedger']) {
    financial[model] = await db[model].findMany({ orderBy: { id: 'asc' } });
  }
  return {
    customers, orders: orders.map(({ id, customerId }) => ({ id, customerId })),
    financialFingerprint: createHash('sha256').update(JSON.stringify(financial)).digest('hex'),
    counts: Object.fromEntries(Object.entries(financial).map(([key, values]) => [key, values.length])),
  };
}

async function verifySharedSales(db, before) {
  const after = await businessSnapshot(db);
  const users = new Set((await db.user.findMany({ select: { id: true } })).map((user) => user.id));
  const customers = await db.customer.findMany({ select: {
    id: true, name: true, normalizedName: true, salesMembers: { where: { removedAt: null }, select: { userId: true } },
  } });
  const orders = await db.order.findMany({ select: { id: true, salesSnapshotTaken: true, salesMembers: { select: { userId: true } } } });
  const originals = new Map(before.customers.map((customer) => [customer.id, customer]));
  const orderOriginals = new Map(before.orders.map((order) => [order.id, order]));
  const incompleteNames = customers.filter((customer) => customer.normalizedName !== normalizeCustomerName(customer.name));
  const missingOwners = customers.filter((customer) => {
    const old = originals.get(customer.id);
    return old?.ownerUserId && users.has(old.ownerUserId) && !customer.salesMembers.some((member) => member.userId === old.ownerUserId);
  });
  const wrongHistory = orders.filter((order) => {
    const old = orderOriginals.get(order.id);
    if (!old) return !order.salesSnapshotTaken;
    const owner = originals.get(old.customerId)?.ownerUserId;
    const expected = owner && users.has(owner) ? [owner] : [];
    return !order.salesSnapshotTaken || JSON.stringify(order.salesMembers.map((member) => member.userId).sort()) !== JSON.stringify(expected);
  });
  return {
    counts: after.counts,
    financialDataUnchanged: before.financialFingerprint === after.financialFingerprint,
    incompleteNames: incompleteNames.length, missingOwners: missingOwners.length, wrongHistory: wrongHistory.length,
    customerMemberships: await db.customerSales.count(), orderAttributions: await db.orderSales.count(),
  };
}

module.exports = { businessSnapshot, verifySharedSales };
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const [mode, path] = process.argv.slice(2);
  if (!['before', 'after'].includes(mode) || !path) throw new Error('Usage: node scripts/verify-shared-sales.js before|after <private-local-snapshot.json>');
  const db = new PrismaClient();
  (async () => {
    if (mode === 'before') {
      const snapshot = await businessSnapshot(db);
      fs.writeFileSync(path, JSON.stringify(snapshot), { flag: 'wx' });
      console.log(JSON.stringify({ saved: true, counts: snapshot.counts }));
    } else {
      const result = await verifySharedSales(db, JSON.parse(fs.readFileSync(path, 'utf8')));
      console.log(JSON.stringify(result));
      if (!result.financialDataUnchanged || result.incompleteNames || result.missingOwners || result.wrongHistory) process.exitCode = 1;
    }
  })().catch((error) => { console.error('Verification failed:', error.code || error.name); process.exitCode = 1; }).finally(() => db.$disconnect());
}
