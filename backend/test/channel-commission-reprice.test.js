const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CommissionMethod,
  CommissionStatus,
  FundSettlementMode,
  PaymentConfirmStatus,
  Prisma,
  SettlementCondition,
} = require('@prisma/client');
const { CommissionsService } = require('../dist/commissions/commissions.service');

const confirmedAt = new Date('2026-09-08T03:00:00.000Z');

function channel(overrides = {}) {
  return {
    id: 7,
    commissionMethod: CommissionMethod.NET_RECEIVED_RATIO,
    defaultCommissionRate: 20,
    defaultCommissionAmount: null,
    ...overrides,
  };
}

function commissionRecord(overrides = {}) {
  return {
    id: 21,
    channelId: 7,
    commissionMethodSnapshot: CommissionMethod.NET_RECEIVED_RATIO,
    commissionRateSnapshot: 15,
    commissionFixedAmountSnapshot: null,
    fundSettlementMode: FundSettlementMode.COMPANY_REBATE,
    calcBaseType: '实收',
    calcBaseAmount: 10000,
    payableAmount: 1500,
    paidAmount: 0,
    unpaidAmount: 1500,
    clawbackAmount: 0,
    status: CommissionStatus.PENDING_REVIEW,
    suspended: false,
    settlementCondition: SettlementCondition.ON_FULL_PAYMENT,
    expectedSettlementAt: confirmedAt,
    actualSettlementAt: null,
    updatedAt: new Date('2026-09-08T04:00:00.000Z'),
    order: {
      id: 42,
      receivableAmount: 20000,
      paidAmount: 10000,
      unpaidAmount: 10000,
      payments: [],
    },
    ...overrides,
  };
}

function setup(records) {
  let query = null;
  const updates = [];
  const audits = [];
  const recordUpdate = ({ where, data }) => {
    updates.push({ where, data });
    return { id: where.id, ...data };
  };
  const tx = {
    commission: {
      findMany: async (args) => {
        query = args;
        return records;
      },
      update: async (args) => recordUpdate(args),
      updateMany: async (args) => {
        recordUpdate(args);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data);
        return data;
      },
    },
  };
  const audit = {
    log: async (data, transaction) => {
      audits.push({ ...data, transaction });
      return data;
    },
  };
  const service = new CommissionsService({}, {}, audit);
  return {
    service,
    tx,
    state: () => ({ query, updates, audits }),
  };
}

function number(value) {
  return Number(value);
}

function settlementSetup(record, { balance = 0, claimCount = 1 } = {}) {
  let transactionOptions = null;
  let claim = null;
  let findUniqueCalls = 0;
  const ledgerCalls = { balances: [], entries: [] };
  const auditCalls = [];
  const tx = {
    commission: {
      findFirst: async () => record,
      updateMany: async (args) => {
        claim = args;
        return { count: claimCount };
      },
      findUnique: async () => {
        findUniqueCalls += 1;
        return { ...record, status: CommissionStatus.PENDING_PAYMENT };
      },
    },
  };
  const prisma = {
    $transaction: async (operation, options) => {
      transactionOptions = options;
      return operation(tx);
    },
  };
  const ledger = {
    getBalance: async (...args) => {
      ledgerCalls.balances.push(args);
      return balance;
    },
    addEntry: async (...args) => {
      ledgerCalls.entries.push(args);
      return args[0];
    },
  };
  const audit = {
    log: async (...args) => {
      auditCalls.push(args);
      return args[0];
    },
  };
  return {
    service: new CommissionsService(prisma, ledger, audit),
    tx,
    state: () => ({
      transactionOptions,
      claim,
      findUniqueCalls,
      ledgerCalls,
      auditCalls,
    }),
  };
}

test('reprices an open net-received commission from 15% to 20%', async () => {
  const record = commissionRecord();
  const { service, tx, state } = setup([record]);

  const result = await service.repriceOpenForChannel(tx, channel(), 9);
  const { query, updates } = state();

  assert.deepEqual(result, {
    updated: 1,
    protected: 0,
    unchanged: 0,
    total: 1,
  });
  assert.equal(query.where.channelId, 7);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, record.id);
  assert.equal(number(updates[0].data.commissionRateSnapshot), 20);
  assert.equal(updates[0].data.commissionFixedAmountSnapshot, null);
  assert.equal(updates[0].data.calcBaseType, '实收');
  assert.equal(number(updates[0].data.calcBaseAmount), 10000);
  assert.equal(number(updates[0].data.payableAmount), 2000);
  assert.equal(number(updates[0].data.paidAmount ?? record.paidAmount), 0);
  assert.equal(number(updates[0].data.unpaidAmount), 2000);
  assert.equal(updates[0].data.status, CommissionStatus.PENDING_REVIEW);
});

test('reprices both unpaid installments for an each-payment commission', async () => {
  const record = commissionRecord({
    calcBaseType: '每笔实收',
    calcBaseAmount: 10000,
    payableAmount: 1500,
    unpaidAmount: 1500,
    settlementCondition: SettlementCondition.ON_EACH_PAYMENT,
    order: {
      id: 42,
      receivableAmount: 10000,
      paidAmount: 8000,
      unpaidAmount: 2000,
      payments: [
        {
          id: 57,
          paymentNo: 'SK000130',
          amount: 8000,
          confirmStatus: PaymentConfirmStatus.CONFIRMED,
          confirmedAt,
          updatedAt: confirmedAt,
          remark: '首款',
          paidAt: new Date('2026-09-08T00:00:00.000Z'),
        },
        {
          id: 58,
          paymentNo: 'SK000130-02',
          amount: 2000,
          confirmStatus: PaymentConfirmStatus.PENDING,
          confirmedAt: null,
          updatedAt: new Date('2026-09-08T03:01:00.000Z'),
          remark: '尾款',
          paidAt: new Date('2026-09-08T00:01:00.000Z'),
        },
      ],
    },
  });
  const { service, tx, state } = setup([record]);

  const result = await service.repriceOpenForChannel(tx, channel());
  const { updates } = state();

  assert.deepEqual(result, {
    updated: 1,
    protected: 0,
    unchanged: 0,
    total: 1,
  });
  assert.equal(updates.length, 1);
  assert.equal(number(updates[0].data.commissionRateSnapshot), 20);
  assert.equal(updates[0].data.calcBaseType, '每笔实收');
  assert.equal(number(updates[0].data.calcBaseAmount), 10000);
  assert.equal(number(updates[0].data.payableAmount), 2000);
  assert.equal(number(updates[0].data.unpaidAmount), 2000);
  assert.equal(updates[0].data.status, CommissionStatus.PENDING_REVIEW);
  assert.equal(updates[0].data.expectedSettlementAt.getTime(), confirmedAt.getTime());
});

test('returns a changed approved amount to pending review', async () => {
  const record = commissionRecord({
    status: CommissionStatus.PENDING_PAYMENT,
  });
  const { service, tx, state } = setup([record]);

  const result = await service.repriceOpenForChannel(tx, channel());
  const { updates } = state();

  assert.equal(result.updated, 1);
  assert.equal(updates.length, 1);
  assert.equal(number(updates[0].data.payableAmount), 2000);
  assert.equal(updates[0].data.status, CommissionStatus.PENDING_REVIEW);
});

test('protects financial history and records that need manual handling', async () => {
  const records = [
    commissionRecord({ id: 1, status: CommissionStatus.PAID }),
    commissionRecord({
      id: 2,
      paidAmount: 500,
      unpaidAmount: 1000,
    }),
    commissionRecord({ id: 3, clawbackAmount: 100 }),
    commissionRecord({ id: 4, suspended: true }),
    commissionRecord({
      id: 5,
      fundSettlementMode: FundSettlementMode.AGENT_NET,
      status: CommissionStatus.SELF_DEDUCTED,
    }),
    commissionRecord({
      id: 6,
      commissionMethodSnapshot: CommissionMethod.SIGNED_RATIO,
    }),
  ];
  const { service, tx, state } = setup(records);

  const result = await service.repriceOpenForChannel(tx, channel());
  const { updates } = state();

  assert.deepEqual(result, {
    updated: 0,
    protected: 6,
    unchanged: 0,
    total: 6,
  });
  assert.equal(updates.length, 0);
});

test('does not write when the snapshot and calculated amounts already match', async () => {
  const record = commissionRecord({
    commissionRateSnapshot: 20,
    payableAmount: 2000,
    unpaidAmount: 2000,
  });
  const { service, tx, state } = setup([record]);

  const result = await service.repriceOpenForChannel(tx, channel());
  const { updates } = state();

  assert.deepEqual(result, {
    updated: 0,
    protected: 0,
    unchanged: 1,
    total: 1,
  });
  assert.equal(updates.length, 0);
});

test('review reports a concurrent amount change when its CAS claim fails', async () => {
  const record = commissionRecord({
    settlementCondition: SettlementCondition.ON_FULL_PAYMENT,
    status: CommissionStatus.PENDING_REVIEW,
  });
  const { service, state } = settlementSetup(record, { claimCount: 0 });

  await assert.rejects(
    service.review(record.id),
    /返佣金额刚刚发生变化，请刷新后重新审核/,
  );
  const { claim, findUniqueCalls, ledgerCalls, auditCalls } = state();

  assert.equal(claim.where.id, record.id);
  assert.equal(claim.where.updatedAt, record.updatedAt);
  assert.equal(claim.where.payableAmount, record.payableAmount);
  assert.equal(claim.where.paidAmount, record.paidAmount);
  assert.equal(claim.where.status, CommissionStatus.PENDING_REVIEW);
  assert.equal(findUniqueCalls, 0);
  assert.equal(ledgerCalls.balances.length, 0);
  assert.equal(ledgerCalls.entries.length, 0);
  assert.equal(auditCalls.length, 0);
});

test('pay reports a concurrent amount change without writing ledger or audit', async () => {
  const record = commissionRecord({
    settlementCondition: SettlementCondition.ON_FULL_PAYMENT,
    status: CommissionStatus.PENDING_PAYMENT,
  });
  const { service, tx, state } = settlementSetup(record, {
    balance: 650,
    claimCount: 0,
  });

  await assert.rejects(
    service.pay({ id: 9 }, record.id, 123),
    /返佣金额刚刚发生变化，请刷新后重新支付/,
  );
  const { claim, ledgerCalls, auditCalls } = state();

  assert.equal(claim.where.id, record.id);
  assert.equal(claim.where.updatedAt, record.updatedAt);
  assert.equal(claim.where.payableAmount, record.payableAmount);
  assert.equal(claim.where.paidAmount, record.paidAmount);
  assert.equal(claim.where.status, CommissionStatus.PENDING_PAYMENT);
  assert.equal(ledgerCalls.balances.length, 1);
  assert.equal(ledgerCalls.balances[0][2], tx);
  assert.equal(ledgerCalls.entries.length, 0);
  assert.equal(auditCalls.length, 0);
});

test('pay locks the financial snapshot and keeps ledger and audit in one transaction', async () => {
  const record = commissionRecord({
    settlementCondition: SettlementCondition.ON_FULL_PAYMENT,
    status: CommissionStatus.PENDING_PAYMENT,
  });
  const { service, tx, state } = settlementSetup(record, { balance: 650 });

  const result = await service.pay({ id: 9 }, record.id, 123);
  const { transactionOptions, claim, ledgerCalls, auditCalls } = state();

  assert.equal(
    transactionOptions.isolationLevel,
    Prisma.TransactionIsolationLevel.Serializable,
  );
  assert.deepEqual(result, {
    id: record.id,
    payable: 1500,
    offset: 650,
    cashOut: 850,
  });
  assert.equal(claim.where.id, record.id);
  assert.equal(claim.where.updatedAt, record.updatedAt);
  assert.equal(claim.where.payableAmount, record.payableAmount);
  assert.equal(claim.where.paidAmount, record.paidAmount);
  assert.equal(claim.where.status, CommissionStatus.PENDING_PAYMENT);
  assert.equal(claim.data.status, CommissionStatus.PAID);
  assert.equal(number(claim.data.paidAmount), 1500);
  assert.equal(number(claim.data.unpaidAmount), 0);
  assert.equal(ledgerCalls.balances.length, 1);
  assert.equal(ledgerCalls.balances[0][0], record.channelId);
  assert.equal(ledgerCalls.balances[0][1], record.currency);
  assert.equal(ledgerCalls.balances[0][2], tx);
  assert.equal(ledgerCalls.entries.length, 1);
  assert.equal(ledgerCalls.entries[0][0].amount, -650);
  assert.equal(ledgerCalls.entries[0][1], tx);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0][0].action, 'PAY_COMMISSION');
  assert.equal(auditCalls[0][1], tx);
});
