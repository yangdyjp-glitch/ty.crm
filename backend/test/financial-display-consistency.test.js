const test = require('node:test');
const assert = require('node:assert/strict');
const { CommissionsService } = require('../dist/commissions/commissions.service');
const { OrdersService } = require('../dist/orders/orders.service');
const { ReportsService } = require('../dist/reports/reports.service');

function commission(overrides = {}) {
  return {
    id: 7, orderId: 8, commissionNo: 'FC000007', channelId: 2, currency: 'CNY', deletedAt: null,
    status: 'SELF_DEDUCTED', fundSettlementMode: 'AGENT_NET', settlementCondition: 'ON_FULL_PAYMENT',
    commissionMethodSnapshot: 'NET_RECEIVED_RATIO', commissionRateSnapshot: 40,
    payableAmount: '400', paidAmount: '0', unpaidAmount: '400', clawbackAmount: '0', suspended: false,
    order: { id: 8, orderNo: 'DD000008', receivableAmount: '1000', paidAmount: '0', payments: [] },
    ...overrides,
  };
}
function listService(records) {
  return new CommissionsService({ commission: { findMany: async () => records } }, {}, {});
}

test('agent-net settlement labels and filters follow actual receipts and deductions', async () => {
  const cases = [
    [0, 400, 'NOT_RECEIVED', 0],
    [1000, 0, 'NO_COMMISSION', 0],
    [0.01, 0.01, 'NOT_DEDUCTED', 0],
    [500, 400, 'PARTIALLY_DEDUCTED', 200],
    [1000, 400, 'SELF_DEDUCTED', 400],
  ];
  const records = cases.map(([received, payable], index) => {
    const c = commission({ id: index + 1, payableAmount: payable });
    c.order.paidAmount = received;
    return c;
  });
  const service = listService(records);
  const rows = (await service.list({ all: '1' })).items;
  assert.deepEqual(rows.map((r) => [r.displayStatus, r.paidAmount]), cases.map(([, , status, paid]) => [status, paid]));
  assert.ok(rows.every((r) => r.status === 'SELF_DEDUCTED'));
  for (const [, , status] of cases) {
    const filtered = await service.list({ all: '1', status });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].displayStatus, status);
  }
});

test('zero commission installments do not appear as pending approval and retain receipt separation', async () => {
  const c = commission({ fundSettlementMode: 'COMPANY_REBATE', status: 'NOT_DUE', settlementCondition: 'ON_EACH_PAYMENT', commissionRateSnapshot: 0, payableAmount: 0 });
  c.order.paidAmount = 800;
  c.order.payments = [
    { id: 1, amount: 800, paymentNo: 'SK1', confirmStatus: 'CONFIRMED', confirmedAt: new Date() },
    { id: 2, amount: 200, paymentNo: 'SK2', confirmStatus: 'PENDING', confirmedAt: null },
  ];
  const service = listService([c]);
  const result = await service.list({ all: '1' });
  assert.equal(result.total, 2);
  assert.ok(result.items.every((r) => r.displayStatus === 'NO_COMMISSION'));
  assert.equal((await service.list({ all: '1', status: 'PENDING_REVIEW' })).total, 0);
  assert.equal((await service.list({ all: '1', status: 'NO_COMMISSION' })).total, 2);
});

test('partially paid rebates are displayed as partial even when the workflow awaits review', async () => {
  const c = commission({ fundSettlementMode: 'COMPANY_REBATE', status: 'PENDING_REVIEW', paidAmount: 100 });
  const service = listService([c]);
  const row = (await service.list({ all: '1' })).items[0];
  assert.equal(row.displayStatus, 'PARTIALLY_PAID');
  assert.equal(row.status, 'PENDING_REVIEW');
  assert.equal((await service.list({ all: '1', status: 'PARTIALLY_PAID' })).total, 1);
});

function reportingOrder(c) {
  return {
    id: 8, customerId: 3, orderNo: 'DD000008', currency: 'CNY', fundSettlementMode: c.fundSettlementMode,
    receivableAmount: 1000, paidAmount: 1000, unpaidAmount: 0, refundAmount: 0,
    customer: { name: '测试', channelId: 2, channel: { id: 2, name: '渠道' } },
    product: { id: 1, name: '服务' }, salesMembers: [], refunds: [], commission: c,
  };
}

test('cancelled commissions retain historical cash but add no unpaid rebate in any report', async () => {
  const c = commission({ fundSettlementMode: 'COMPANY_REBATE', status: 'CANCELLED', paidAmount: 100, unpaidAmount: 0 });
  const order = reportingOrder(c);
  const prisma = {
    order: { findMany: async () => [order], count: async () => 1 },
    $transaction: async (ops) => Promise.all(ops),
  };
  const reports = new ReportsService(prisma);
  const finance = (await reports.finance({ period: 'all' })).summary[0];
  const channel = (await reports.channels())[0];
  const cash = (await new CommissionsService(prisma, {}, {}).cashAccounts({ all: '1' })).items[0];
  assert.equal(finance.pendingRebate, 0);
  assert.equal(channel._sum.unpaidAmount, 0);
  assert.equal(channel._sum.paidAmount, 100);
  assert.equal(finance.balance, 900);
  assert.equal(channel._sum.companyNetReceived, 900);
  assert.equal(cash.balance, 900);
  assert.equal(cash.rebateStatus, '已取消');
});

test('rebates paid on signing stay visible before the first collection', async () => {
  const c = commission({ fundSettlementMode: 'COMPANY_REBATE', status: 'PENDING_REVIEW', paidAmount: 100 });
  const order = { ...reportingOrder(c), paidAmount: 0, unpaidAmount: 1000 };
  const prisma = { order: { findMany: async () => [order], count: async () => 1 }, $transaction: async (ops) => Promise.all(ops) };
  const service = new CommissionsService(prisma, {}, {});
  const row = (await service.cashAccounts({ all: '1' })).items[0];
  assert.equal(row.rebateStatus, '已部分返佣');
  assert.equal(row.actualReceived, 0);
  assert.equal(row.balance, -100);
  c.paidAmount = 400;
  assert.equal((await service.cashAccounts({ all: '1' })).items[0].rebateStatus, '已返佣');
});

function deletionSetup(c, { payments = [], refunds = [], ledgerCount = 0, orderReceived = Number(c.order.paidAmount) } = {}) {
  const writes = [];
  let options;
  const tx = {
    $queryRaw: async () => [],
    order: {
      findFirst: async () => ({ ...reportingOrder(c), paidAmount: orderReceived }),
      update: async (args) => writes.push(['order', args]),
    },
    payment: { findMany: async () => payments, updateMany: async (args) => writes.push(['payments', args]) },
    refund: { findMany: async () => refunds, updateMany: async (args) => writes.push(['refunds', args]) },
    commission: {
      findFirst: async () => c,
      update: async ({ data }) => { writes.push(['commission', data]); return { ...c, ...data }; },
      updateMany: async (args) => writes.push(['commissions', args]),
    },
    channelLedger: { count: async () => ledgerCount },
    auditLog: { create: async (args) => writes.push(['audit', args]) },
  };
  const prisma = { $transaction: async (fn, opts) => { options = opts; return fn(tx); } };
  return {
    commissions: new CommissionsService(prisma, {}, {}),
    orders: new OrdersService(prisma, { recomputeMainStatus: async () => {} }, {}),
    writes, options: () => options,
  };
}

test('direct and cascading deletion both reject paid commissions before any writes', async () => {
  const c = commission({ fundSettlementMode: 'COMPANY_REBATE', paidAmount: 100, status: 'PENDING_REVIEW' });
  c.order.paidAmount = 0;
  for (const operation of ['direct', 'order']) {
    const h = deletionSetup(c);
    await assert.rejects(operation === 'direct' ? h.commissions.remove(c.id) : h.orders.remove({ id: 1, role: 'ADMIN' }, 8), /不能删除/);
    assert.equal(h.writes.length, 0);
    assert.equal(h.options().isolationLevel, 'Serializable');
  }
});

test('agent deductions, clawbacks and ledger history prevent deletion even with a zero paid cache', async () => {
  const cases = [commission({ clawbackAmount: 20 }), commission(), commission()];
  cases[1].order.paidAmount = 1000;
  for (const [i, c] of cases.entries()) {
    const h = deletionSetup(c, { ledgerCount: i === 2 ? 1 : 0 });
    await assert.rejects(h.commissions.remove(c.id), /不能删除/);
    assert.equal(h.writes.length, 0);
  }
});

test('unsettled commission deletion succeeds and saves an audit record in its transaction', async () => {
  const c = commission({ fundSettlementMode: 'COMPANY_REBATE', status: 'NOT_DUE' });
  const h = deletionSetup(c);
  const result = await h.commissions.remove(c.id, { id: 1 });
  assert.ok(result.deletedAt);
  assert.deepEqual(h.writes.map(([kind]) => kind), ['commission', 'audit']);
});

test('order deletion error never instructs users to delete confirmed receipts or executed refunds', async () => {
  const c = commission({ fundSettlementMode: 'COMPANY_REBATE', status: 'NOT_DUE' });
  const h = deletionSetup(c, { payments: [{ paymentNo: 'SK1' }], refunds: [{ refundNo: 'TK1' }] });
  await assert.rejects(h.orders.remove({ id: 1, role: 'ADMIN' }, 8), (error) => {
    const response = error.getResponse();
    assert.deepEqual(response.blockingPayments, ['SK1']);
    assert.deepEqual(response.blockingRefunds, ['TK1']);
    assert.ok(!response.message.includes('先到收款'));
    return error.getStatus() === 400;
  });
  assert.equal(h.writes.length, 0);
});

test('an order with no executed financial history can still be deleted and audited', async () => {
  const c = commission({ fundSettlementMode: 'COMPANY_REBATE', status: 'NOT_DUE' });
  const h = deletionSetup(c);
  assert.deepEqual(await h.orders.remove({ id: 1, role: 'ADMIN' }, 8), { ok: true });
  assert.deepEqual(h.writes.map(([kind]) => kind), ['payments', 'refunds', 'commissions', 'order', 'audit']);
});

test('order financial totals also prevent deletion if its old payment rows were removed', async () => {
  const c = commission({ fundSettlementMode: 'COMPANY_REBATE', status: 'NOT_DUE' });
  const h = deletionSetup(c, { orderReceived: 1000 });
  await assert.rejects(h.orders.remove({ id: 1, role: 'ADMIN' }, 8), /不能删除/);
  assert.equal(h.writes.length, 0);
});
