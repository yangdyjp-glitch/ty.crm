const test = require('node:test');
const assert = require('node:assert/strict');
const { syncCustomerChannel } = require('../dist/common/customer-channel-sync');
const { CustomersService } = require('../dist/customers/customers.service');

const version = new Date('2026-11-17T01:00:00Z');
const target = { id: 6, customerNo: 'KH000206', channelId: 6 };
const operator = { id: 1, role: 'ADMIN', name: '管理员' };
function channel(overrides = {}) {
  return {
    id: 6, name: '行知学园（上海）', channelType: 'ENTERPRISE',
    commissionMethod: 'NET_RECEIVED_RATIO', defaultCommissionRate: 40,
    defaultCommissionAmount: null, fundSettlementMode: 'AGENT_NET',
    settlementCondition: 'ON_FULL_PAYMENT', ...overrides,
  };
}
function order(overrides = {}) {
  return {
    id: 57, orderNo: 'DD000206', customerId: target.id, currency: 'CNY',
    receivableAmount: 36000, paidAmount: 0, unpaidAmount: 36000, refundAmount: 0,
    status: 'IN_SERVICE', fundSettlementMode: 'AGENT_NET', hasCommission: true,
    product: { participateCommission: true }, refunds: [],
    payments: [
      { id: 74, amount: 30000, confirmStatus: 'PENDING' },
      { id: 75, amount: 6000, confirmStatus: 'PENDING' },
    ],
    commission: {
      id: 34, orderId: 57, customerId: target.id, commissionNo: 'FC000206', channelId: 3,
      channelNameSnapshot: '行知学园（日本）', currency: 'CNY', commissionMethodSnapshot: 'NET_RECEIVED_RATIO',
      commissionRateSnapshot: 40, commissionFixedAmountSnapshot: null, fundSettlementMode: 'AGENT_NET',
      settlementCondition: 'ON_FULL_PAYMENT', calcBaseType: '应收(代收)', calcBaseAmount: 36000,
      payableAmount: 14400, paidAmount: 0, unpaidAmount: 14400, clawbackAmount: 0,
      status: 'SELF_DEDUCTED', suspended: false, actualSettlementAt: null, reviewedById: null,
      paidById: null, paymentVoucherAttachmentId: null, deletedAt: null, updatedAt: version,
    },
    ...overrides,
  };
}
function setup(orders = [order()], config = channel(), ledger = []) {
  let state = {
    orders: structuredClone(orders), audits: [],
    customer: { id: target.id, customerNo: target.customerNo, channelId: 3, name: '陶乐阳',
      sourceCategory: 'ENTERPRISE_THIRD_PARTY', channelNameSnapshot: '行知学园（日本）', updatedAt: version },
  };
  let transactionOptions;
  const tx = {
    $queryRaw: async () => [],
    channel: { findFirst: async () => config },
    customer: {
      findFirst: async () => state.customer,
      update: async ({ data }) => (state.customer = { ...state.customer, ...data }),
    },
    channelLedger: { findMany: async () => ledger },
    order: {
      findMany: async () => state.orders,
      update: async ({ where, data }) => Object.assign(state.orders.find((o) => o.id === where.id), data),
    },
    commission: {
      findMany: async () => state.orders.flatMap((o) => o.commission ? [o.commission] : []),
      update: async ({ where, data }) => {
        const o = state.orders.find((o) => o.commission?.id === where.id);
        o.commission = { ...o.commission, ...data };
        return o.commission;
      },
      create: async ({ data }) => {
        const o = state.orders.find((o) => o.id === data.orderId);
        o.commission = { id: 100, paidAmount: 0, ...data };
        return o.commission;
      },
    },
    auditLog: {
      create: async ({ data }) => state.audits.push(data),
      createMany: async ({ data }) => state.audits.push(...data),
    },
  };
  const prisma = { $transaction: async (operation, options) => {
    transactionOptions = options;
    const before = structuredClone(state);
    try { return await operation(tx); } catch (e) { state = before; throw e; }
  } };
  return { tx, service: new CustomersService(prisma), state: () => state, options: () => transactionOptions };
}
function companyOrder(received = 30000) {
  const o = order();
  o.fundSettlementMode = 'COMPANY_REBATE';
  o.paidAmount = received;
  o.unpaidAmount = 36000 - received;
  o.payments[0].confirmStatus = received ? 'CONFIRMED' : 'PENDING';
  if (received === 36000) o.payments[1].confirmStatus = 'CONFIRMED';
  Object.assign(o.commission, { fundSettlementMode: 'COMPANY_REBATE', status: 'PENDING_PAYMENT', reviewedById: 2 });
  return o;
}

test('customer update moves unpaid agent-net commission to Shanghai atomically, preserving money and receipts', async () => {
  const h = setup();
  const beforePayments = structuredClone(h.state().orders[0].payments);
  await h.service.update(operator, target.id, { channelId: 6, expectedUpdatedAt: version.toISOString() });
  const { customer, orders, audits } = h.state();
  assert.equal(customer.channelId, 6);
  assert.equal(orders[0].commission.channelId, 6);
  assert.equal(orders[0].commission.channelNameSnapshot, '行知学园（上海）');
  assert.equal(orders[0].commission.payableAmount, 14400);
  assert.equal(orders[0].commission.paidAmount, 0);
  assert.deepEqual(orders[0].payments, beforePayments);
  assert.equal(h.options().isolationLevel, 'Serializable');
  assert.ok(audits.some((a) => a.relatedType === 'Customer'));
  const audit = audits.find((a) => a.relatedType === 'Commission');
  assert.equal(JSON.parse(audit.oldValue).channelId, 3);
  assert.equal(JSON.parse(audit.newValue).channelId, 6);
});

test('new customer channel pricing replaces the old rate and invalidates old approval', async () => {
  const h = setup([companyOrder()], channel({ defaultCommissionRate: 20, fundSettlementMode: 'COMPANY_REBATE' }));
  await syncCustomerChannel(h.tx, target, operator.id);
  const c = h.state().orders[0].commission;
  assert.equal(c.commissionRateSnapshot, 20);
  assert.equal(c.payableAmount, 6000);
  assert.equal(c.unpaidAmount, 6000);
  assert.equal(c.status, 'NOT_DUE');
  assert.equal(c.reviewedById, null);
});

test('each-payment pricing retains both installments and only confirmed receipts become due', async () => {
  const h = setup([companyOrder()], channel({ fundSettlementMode: 'COMPANY_REBATE', settlementCondition: 'ON_EACH_PAYMENT', defaultCommissionRate: 20 }));
  await syncCustomerChannel(h.tx, target, operator.id);
  const c = h.state().orders[0].commission;
  assert.equal(c.payableAmount, 7200);
  assert.equal(c.calcBaseAmount, 36000);
  assert.equal(c.calcBaseType, '每笔实收');
  assert.equal(c.status, 'PENDING_REVIEW');
  const { CommissionsService } = require('../dist/commissions/commissions.service');
  const breakdown = new CommissionsService({}, {}, {}).eachPaymentState({ ...c, order: h.state().orders[0] });
  assert.deepEqual(breakdown.installments.map((p) => [p.payableAmount, p.status]), [
    [6000, 'PENDING_REVIEW'], [1200, 'NOT_DUE'],
  ]);
});

test('already fulfilled full-payment and service-completion conditions become pending review', async () => {
  for (const condition of ['ON_FULL_PAYMENT', 'ON_SERVICE_COMPLETE']) {
    const o = companyOrder(36000);
    o.status = 'COMPLETED';
    const h = setup([o], channel({ fundSettlementMode: 'COMPANY_REBATE', settlementCondition: condition }));
    await syncCustomerChannel(h.tx, target, operator.id);
    assert.equal(h.state().orders[0].commission.status, 'PENDING_REVIEW');
  }
});

test('fixed commission is recalculated from the new channel default', async () => {
  const h = setup([order()], channel({ commissionMethod: 'FIXED_AMOUNT', defaultCommissionRate: null, defaultCommissionAmount: 900 }));
  await syncCustomerChannel(h.tx, target, operator.id);
  const c = h.state().orders[0].commission;
  assert.equal(c.payableAmount, 900);
  assert.equal(c.commissionRateSnapshot, null);
  assert.equal(c.commissionFixedAmountSnapshot, 900);
});

test('paid, deducted, refunded, suspended and ledger-backed records block the whole customer update', async () => {
  const cases = [
    (o) => { o.commission.paidAmount = 100; },
    (o) => { o.payments[0].confirmStatus = 'CONFIRMED'; o.paidAmount = 30000; },
    (o) => { o.refunds = [{ id: 1 }]; },
    (o) => { o.commission.clawbackAmount = 100; },
    (o) => { o.commission.suspended = true; },
    (o) => { o.commission.deletedAt = version; },
    (o) => { o.commission.status = 'CANCELLED'; },
    (o) => { o.status = 'REFUNDED'; },
    () => {},
  ];
  for (const [index, modify] of cases.entries()) {
    const o = order();
    modify(o);
    const h = setup([o], channel(), index === cases.length - 1 ? [{ relatedOrderId: o.id }] : []);
    const before = structuredClone(h.state());
    await assert.rejects(h.service.update(operator, target.id, { channelId: 6, expectedUpdatedAt: version.toISOString() }), /先核对历史分成/);
    assert.deepEqual(h.state(), before);
  }
});

test('same-channel profile edits leave historical paid commission and settlement condition unchanged', async () => {
  const o = order();
  Object.assign(o.commission, { paidAmount: 14400, settlementCondition: 'ON_SIGN' });
  const h = setup([o], channel({ id: 3 }));
  await h.service.update(operator, target.id, { channelId: 3, remark: '资料更新', expectedUpdatedAt: version.toISOString() });
  assert.deepEqual(h.state().orders[0].commission, o.commission);
  assert.equal(h.state().audits.filter((a) => a.relatedType === 'Commission').length, 0);
});

test('changing fund mode after a receipt requires a history preview', async () => {
  const h = setup([companyOrder()], channel());
  await assert.rejects(syncCustomerChannel(h.tx, target, operator.id), /先核对历史分成/);
});

test('self-acquired unpaid order gains a commission, or loses an unpaid commission when changed to self-acquired', async () => {
  const h = setup([order({ commission: null, fundSettlementMode: 'COMPANY_DIRECT', hasCommission: false })]);
  await syncCustomerChannel(h.tx, target, operator.id);
  assert.equal(h.state().orders[0].commission.commissionNo, 'FC000206');
  assert.equal(h.state().orders[0].hasCommission, true);
  assert.equal(h.state().orders[0].fundSettlementMode, 'AGENT_NET');
  const own = setup();
  await syncCustomerChannel(own.tx, { ...target, channelId: null }, operator.id);
  assert.equal(own.state().orders[0].hasCommission, false);
  assert.equal(own.state().orders[0].fundSettlementMode, 'COMPANY_DIRECT');
  assert.ok(own.state().orders[0].commission.deletedAt);
});

test('nonparticipating products remain without commission', async () => {
  const h = setup([order({ commission: null, hasCommission: false, product: { participateCommission: false } })]);
  await syncCustomerChannel(h.tx, target, operator.id);
  assert.equal(h.state().orders[0].commission, null);
  assert.equal(h.state().orders[0].hasCommission, false);
});

test('unconfigured pricing, oversized fixed commission and in-flight receipts fail without changes', async () => {
  for (const config of [channel({ defaultCommissionRate: null }), channel({ commissionMethod: 'FIXED_AMOUNT', defaultCommissionAmount: 50000 })]) {
    const h = setup([order()], config);
    await assert.rejects(syncCustomerChannel(h.tx, target, operator.id), /默认返佣|不能超过/);
    assert.equal(h.state().audits.length, 0);
  }
  const h = setup([order({ paidAmount: 1 })]);
  await assert.rejects(syncCustomerChannel(h.tx, target, operator.id), (e) => e.getStatus() === 409);
});

test('a receipt recalculation racing with a channel change retries using the new channel rate', async () => {
  const { CommissionsService } = require('../dist/commissions/commissions.service');
  const o = companyOrder();
  const old = { ...o.commission, order: o };
  const latest = { ...old, channelId: 6, commissionRateSnapshot: 20, status: 'NOT_DUE', updatedAt: new Date(version.getTime() + 1) };
  let reads = 0;
  const writes = [];
  const service = new CommissionsService({ commission: {
    findUnique: async () => reads++ === 0 ? old : latest,
    update: async (args) => {
      writes.push(args);
      if (writes.length === 1) throw { code: 'P2025' };
      return { ...latest, ...args.data };
    },
  } }, {}, {});
  const result = await service.onPaymentConfirmed(o.id);
  assert.equal(writes[0].where.updatedAt, old.updatedAt);
  assert.equal(writes[1].where.updatedAt, latest.updatedAt);
  assert.equal(result.payableAmount, 6000);
  assert.equal(result.status, 'NOT_DUE');
});

test('installment recalculation cannot overwrite a newer channel rate', async () => {
  const { CommissionsService } = require('../dist/commissions/commissions.service');
  const o = companyOrder();
  const old = { ...o.commission, settlementCondition: 'ON_EACH_PAYMENT', order: o };
  const latest = { ...old, commissionRateSnapshot: 20, updatedAt: new Date(version.getTime() + 1) };
  let reads = 0;
  let writes = 0;
  const service = new CommissionsService({ commission: {
    findFirst: async () => reads++ === 0 ? old : latest,
    update: async ({ where, data }) => {
      if (++writes === 1) throw { code: 'P2025' };
      assert.equal(where.updatedAt, latest.updatedAt);
      return { ...latest, ...data };
    },
  } }, {}, {});
  const result = await service.syncEachPaymentCommissionById(old.id);
  assert.equal(result.payableAmount, 7200);
});

test('recalculation never revives a commission removed by switching to self-acquired', async () => {
  const { CommissionsService } = require('../dist/commissions/commissions.service');
  const o = companyOrder();
  let reads = 0;
  let writes = 0;
  const service = new CommissionsService({ commission: {
    findUnique: async () => ({ ...o.commission, order: o, deletedAt: reads++ === 0 ? null : version }),
    update: async () => { writes++; throw { code: 'P2025' }; },
  } }, {}, {});
  await service.onPaymentConfirmed(o.id);
  assert.equal(writes, 1);
});
