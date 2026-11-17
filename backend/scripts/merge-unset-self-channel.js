const { PrismaClient, Prisma } = require('@prisma/client');
const { databaseOptions } = require('../dist/prisma/database-options');

// Explicit maintenance command, never a startup hook. Run without --apply to preview.
async function mergeUnsetSelfChannel(prisma, apply = false) {
  return prisma.$transaction(async (tx) => {
    if (apply) await tx.$queryRaw`SELECT pg_advisory_xact_lock(20773, 1)::text`;
    else await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const channel = await tx.acquisitionChannel.findFirst({
      where: { name: '个人渠道', active: true, deletedAt: null }, select: { id: true, name: true },
    });
    if (!channel) throw new Error('Active personal acquisition channel is missing');
    const where = { deletedAt: null, sourceCategory: 'SELF', acquisitionChannelId: null };
    const customers = await tx.customer.findMany({
      where, orderBy: { id: 'asc' }, select: { id: true, customerNo: true, channelId: true },
    });
    if (customers.some((customer) => customer.channelId != null)) {
      throw new Error('An unset self-acquired customer has an unexpected third-party channel');
    }
    const orderWhere = { deletedAt: null, customerId: { in: customers.map((c) => c.id) } };
    const financialRead = {
      where: orderWhere, orderBy: { id: 'asc' },
      include: {
        payments: { orderBy: { id: 'asc' } }, commission: true,
        refunds: { orderBy: { id: 'asc' } }, salesMembers: { orderBy: { userId: 'asc' } },
      },
    };
    const before = await tx.order.findMany(financialRead);
    if (before.some((order) => order.fundSettlementMode !== 'COMPANY_DIRECT'
      || order.commission && order.commission.deletedAt == null)) {
      throw new Error('Unexpected financial channel history; review before merging');
    }
    const result = { channel, customers: customers.length, orders: before.length, updated: 0, audited: 0 };
    if (!apply || !customers.length) return result;
    const updated = await tx.customer.updateMany({
      where: { ...where, id: { in: customers.map((c) => c.id) } },
      data: { acquisitionChannelId: channel.id },
    });
    if (updated.count !== customers.length) throw new Error('Customer records changed; retry after review');
    const audit = await tx.auditLog.createMany({ data: customers.map((customer) => ({
      operatorId: null, relatedType: 'Customer', relatedId: customer.id,
      action: 'UPDATE_CUSTOMER', fieldName: 'acquisitionChannelId', oldValue: 'null', newValue: String(channel.id),
      reason: '用户确认合并：将自获取且未设置渠道的客户统一归入个人渠道（2026-11-17）',
    })) });
    if (audit.count !== updated.count) throw new Error('Audit count mismatch');
    const after = await tx.order.findMany(financialRead);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Financial records changed; merge rolled back');
    return { ...result, updated: updated.count, audited: audit.count, financialRecordsUnchanged: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000, maxWait: 15000 });
}

module.exports = { mergeUnsetSelfChannel };
if (require.main === module) {
  const prisma = new PrismaClient(databaseOptions());
  mergeUnsetSelfChannel(prisma, process.argv.includes('--apply'))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(JSON.stringify({ error: error.code || error.name, reason: error.code ? 'Database operation failed' : error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted]') }));
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
