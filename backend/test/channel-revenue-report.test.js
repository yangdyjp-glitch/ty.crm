const test = require('node:test');
const assert = require('node:assert/strict');
const { ReportsService } = require('../dist/reports/reports.service');

const xidian = { id: 15, name: '西安电子科技大学' };
const partner = { id: 2, name: '合作渠道' };

function order(overrides = {}) {
  return {
    id: 1,
    currency: 'CNY',
    receivableAmount: '48000',
    paidAmount: '48000',
    unpaidAmount: '0',
    fundSettlementMode: 'AGENT_NET',
    customer: { channelId: xidian.id, channel: xidian },
    commission: null,
    refunds: [],
    ...overrides,
  };
}

function commission(overrides = {}) {
  return {
    channelId: xidian.id,
    channel: xidian,
    channelNameSnapshot: xidian.name,
    fundSettlementMode: 'AGENT_NET',
    payableAmount: '0',
    paidAmount: '0',
    deletedAt: null,
    ...overrides,
  };
}

function setup(orders) {
  const calls = [];
  const service = new ReportsService({
    order: {
      findMany: async (query) => {
        calls.push(query);
        return orders;
      },
    },
  });
  return { service, calls };
}

test('a zero-commission channel still reports its fully collected contract revenue', async () => {
  const { service } = setup([order({ commission: commission() })]);
  const [row] = await service.channels();
  assert.equal(row.channel.name, xidian.name);
  assert.equal(row._count, 1);
  assert.deepEqual(row._sum, {
    receivableAmount: 48000,
    confirmedReceived: 48000,
    orderUnpaidAmount: 0,
    payableAmount: 0,
    paidAmount: 0,
    unpaidAmount: 0,
    companyNetReceived: 48000,
  });
});

test('orders without commission records are included and shared sales do not double count revenue', async () => {
  const { service } = setup([
    order({ salesMembers: [{ userId: 1 }, { userId: 2 }] }),
    order({ id: 2, receivableAmount: '8000', paidAmount: '3000', unpaidAmount: '5000' }),
  ]);
  const rows = await service.channels();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]._count, 2);
  assert.equal(rows[0]._sum.receivableAmount, 56000);
  assert.equal(rows[0]._sum.confirmedReceived, 51000);
  assert.equal(rows[0]._sum.orderUnpaidAmount, 5000);
  assert.equal(rows[0]._sum.companyNetReceived, 51000);
});

test('only actual order currencies create rows and a mixed-currency channel is never summed across currencies', async () => {
  const { service } = setup([
    order(),
    order({ id: 2, currency: 'JPY', receivableAmount: '700000', paidAmount: '400000', unpaidAmount: '300000' }),
    order({ id: 3, customer: { channelId: partner.id, channel: partner } }),
  ]);
  const rows = await service.channels();
  const mixed = rows.filter((row) => row.channelId === xidian.id);
  assert.deepEqual(mixed.map((row) => row.currency), ['CNY', 'JPY']);
  assert.deepEqual(mixed.map((row) => row._sum.confirmedReceived), [48000, 400000]);
  assert.equal(rows.filter((row) => row.channelId === partner.id).length, 1);
  assert.equal(rows.reduce((sum, row) => sum + row._count, 0), 3);
});

test('net receipts deduct actual rebates, prorated agent deductions and completed company cash refunds', async () => {
  const { service } = setup([
    order({
      receivableAmount: '10000', paidAmount: '8000', unpaidAmount: '2000',
      fundSettlementMode: 'COMPANY_REBATE',
      commission: commission({ fundSettlementMode: 'COMPANY_REBATE', payableAmount: '2000', paidAmount: '1000' }),
      refunds: [
        { status: 'REFUNDED', bearer: 'COMPANY', cashAmount: '500' },
        { status: 'PENDING', bearer: 'COMPANY', cashAmount: '900' },
        { status: 'REFUNDED', bearer: 'THIRD_PARTY', cashAmount: '600' },
      ],
    }),
    order({
      id: 2, receivableAmount: '10000', paidAmount: '5000', unpaidAmount: '5000',
      // Agent deduction is derived from collected revenue, not this stored paid value.
      commission: commission({ payableAmount: '4000', paidAmount: '0' }),
    }),
  ]);
  const [row] = await service.channels();
  assert.deepEqual(row._sum, {
    receivableAmount: 20000,
    confirmedReceived: 13000,
    orderUnpaidAmount: 7000,
    payableAmount: 6000,
    paidAmount: 3000,
    unpaidAmount: 3000,
    companyNetReceived: 9500,
  });
});

test('channel attribution uses the signed snapshot and deleted commissions do not deduct money', async () => {
  const { service } = setup([
    order({
      customer: { channelId: partner.id, channel: partner },
      commission: commission({ payableAmount: '9600', paidAmount: '9600', deletedAt: new Date() }),
    }),
    order({
      id: 2, customer: { channelId: partner.id, channel: partner },
      commission: commission({ payableAmount: '9600', paidAmount: '0' }),
    }),
  ]);
  const [row] = await service.channels();
  assert.equal(row.channelId, xidian.id);
  assert.equal(row._count, 2);
  assert.equal(row._sum.payableAmount, 9600);
  assert.equal(row._sum.paidAmount, 9600);
  assert.equal(row._sum.companyNetReceived, 86400);
});

test('year and month filters select undeleted orders by signing time and only completed undeleted refunds', async () => {
  const { service, calls } = setup([]);
  assert.deepEqual(await service.channels({ period: 'year', year: '2026' }), []);
  await service.channels({ period: 'month', month: '2026-10' });
  assert.deepEqual(calls[0].where.signedAt, {
    gte: new Date(2026, 0, 1), lt: new Date(2027, 0, 1),
  });
  assert.deepEqual(calls[1].where.signedAt, {
    gte: new Date(2026, 9, 1), lt: new Date(2026, 10, 1),
  });
  for (const query of calls) {
    assert.equal(query.where.deletedAt, null);
    assert.deepEqual(query.include.refunds.where, { deletedAt: null, status: 'REFUNDED' });
  }
});

test('cash refunds preserve a zero outstanding balance and fractional receipts are rounded', async () => {
  const { service } = setup([
    order({
      receivableAmount: '1000', paidAmount: '400', unpaidAmount: '0',
      fundSettlementMode: 'COMPANY_DIRECT',
      refunds: [{ status: 'REFUNDED', bearer: 'COMPANY', cashAmount: '100' }],
    }),
    order({ id: 2, receivableAmount: '0.1', paidAmount: '0.1' }),
    order({ id: 3, receivableAmount: '0.2', paidAmount: '0.2' }),
  ]);
  const [row] = await service.channels();
  assert.equal(row._sum.receivableAmount, 1000.3);
  assert.equal(row._sum.confirmedReceived, 400.3);
  assert.equal(row._sum.orderUnpaidAmount, 0);
  assert.equal(row._sum.companyNetReceived, 300.3);
});
