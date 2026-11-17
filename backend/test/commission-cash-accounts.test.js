const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CommissionStatus,
  FundSettlementMode,
} = require('@prisma/client');
const { CommissionsService } = require('../dist/commissions/commissions.service');

function orderWithCommission({ payableAmount, paidAmount, status }) {
  return {
    id: 1,
    currency: 'CNY',
    receivableAmount: 20000,
    paidAmount: 10000,
    fundSettlementMode: FundSettlementMode.COMPANY_REBATE,
    customer: {
      name: '测试客户',
      channelNameSnapshot: '测试渠道',
      channel: null,
      acquisitionChannel: null,
    },
    commission: {
      deletedAt: null,
      payableAmount,
      paidAmount,
      status,
      fundSettlementMode: FundSettlementMode.COMPANY_REBATE,
      channelNameSnapshot: '测试渠道',
    },
    refunds: [],
  };
}

async function cashAccount(order) {
  const prisma = {
    order: {
      findMany: async () => [order],
      count: async () => 1,
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  const service = new CommissionsService(prisma, {}, {});
  const result = await service.cashAccounts({ all: '1' });
  return result.items[0];
}

async function cashAccountStatus(commission) {
  return (await cashAccount(orderWithCommission(commission))).rebateStatus;
}

test('cash account rebate status follows the amount already paid', async () => {
  assert.equal(
    await cashAccountStatus({
      payableAmount: 3000,
      paidAmount: 0,
      status: CommissionStatus.PAID,
    }),
    '未返佣',
  );
  assert.equal(
    await cashAccountStatus({
      payableAmount: 3000,
      paidAmount: 1500,
      status: CommissionStatus.NOT_DUE,
    }),
    '已部分返佣',
  );
  assert.equal(
    await cashAccountStatus({
      payableAmount: 3000,
      paidAmount: 3000,
      status: CommissionStatus.PENDING_REVIEW,
    }),
    '已返佣',
  );
});

test('confirmed zero-commission receipts show no rebate and retain all company cash', async () => {
  for (const mode of [FundSettlementMode.AGENT_NET, FundSettlementMode.COMPANY_REBATE]) {
    const order = orderWithCommission({ payableAmount: '0', paidAmount: '0', status: CommissionStatus.SELF_DEDUCTED });
    order.receivableAmount = '48000';
    order.paidAmount = '48000';
    order.fundSettlementMode = mode;
    order.commission.fundSettlementMode = mode;
    const row = await cashAccount(order);
    assert.equal(row.rebateStatus, '无返佣');
    assert.equal(row.contractAmount, 48000);
    assert.equal(row.actualReceived, 48000);
    assert.equal(row.balance, 48000);
  }
});

test('zero commission does not imply that a pending receipt has arrived', async () => {
  const order = orderWithCommission({ payableAmount: 0, paidAmount: 0, status: CommissionStatus.SELF_DEDUCTED });
  order.paidAmount = 0;
  order.fundSettlementMode = FundSettlementMode.AGENT_NET;
  order.commission.fundSettlementMode = FundSettlementMode.AGENT_NET;
  const row = await cashAccount(order);
  assert.equal(row.rebateStatus, '未到账');
  assert.equal(row.actualReceived, 0);
  assert.equal(row.balance, 0);
});

test('agent deductions distinguish pending, partial and full deductions from receipt confirmation', async () => {
  const order = orderWithCommission({ payableAmount: 10, paidAmount: 0, status: CommissionStatus.SELF_DEDUCTED });
  order.receivableAmount = 10000;
  order.fundSettlementMode = FundSettlementMode.AGENT_NET;
  order.commission.fundSettlementMode = FundSettlementMode.AGENT_NET;
  for (const [received, expectedStatus, expectedCash] of [
    [0, '未到账', 0],
    [0.01, '未自扣', 0.01],
    [5000, '部分自扣', 4995],
    [10000, '已自扣', 9990],
  ]) {
    order.paidAmount = received;
    const row = await cashAccount(order);
    assert.equal(row.rebateStatus, expectedStatus);
    assert.equal(row.actualReceived, expectedCash);
    assert.equal(row.balance, expectedCash);
  }
});

test('historical cash payments remain visible even when the current commission payable is zero', async () => {
  const row = await cashAccount(orderWithCommission({ payableAmount: 0, paidAmount: 1500, status: CommissionStatus.PAID }));
  assert.equal(row.rebateStatus, '已返佣');
  assert.equal(row.balance, 8500);
});
