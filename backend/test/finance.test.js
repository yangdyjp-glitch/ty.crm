const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CommissionMethod,
  FundSettlementMode,
  RefundBearer,
  RefundStatus,
} = require('@prisma/client');
const {
  commissionQuote,
  companyCashRefunds,
  orderCashPosition,
  refundBreakdown,
} = require('../dist/common/finance');

test('three commission methods use the correct base or fixed value', () => {
  const common = {
    configuredValue: 15,
    fundSettlementMode: FundSettlementMode.COMPANY_REBATE,
    receivableAmount: 1000,
    confirmedReceived: 400,
  };
  assert.equal(
    commissionQuote({ ...common, method: CommissionMethod.NET_RECEIVED_RATIO })
      .payableAmount,
    60,
  );
  assert.equal(
    commissionQuote({ ...common, method: CommissionMethod.SIGNED_RATIO })
      .payableAmount,
    150,
  );
  assert.equal(
    commissionQuote({
      ...common,
      method: CommissionMethod.FIXED_AMOUNT,
      configuredValue: 28000,
    }).payableAmount,
    28000,
  );
});

test('agent net ratio is realized in proportion to confirmed collection', () => {
  const quote = commissionQuote({
    method: CommissionMethod.NET_RECEIVED_RATIO,
    configuredValue: 40,
    fundSettlementMode: FundSettlementMode.AGENT_NET,
    receivableAmount: 38000,
    confirmedReceived: 19000,
  });
  const cash = orderCashPosition({
    confirmedReceived: 19000,
    receivableAmount: 38000,
    companyCashRefund: 0,
    fundSettlementMode: FundSettlementMode.AGENT_NET,
    commission: { payableAmount: quote.payableAmount, paidAmount: 0 },
  });
  assert.deepEqual(cash, {
    channelSettled: 7600,
    actualReceived: 11400,
    balance: 11400,
  });
});

test('agent net signed-ratio and fixed commissions are also prorated by collection', () => {
  const cases = [
    { method: CommissionMethod.SIGNED_RATIO, configuredValue: 15, settled: 6000 },
    { method: CommissionMethod.FIXED_AMOUNT, configuredValue: 28000, settled: 11200 },
  ];
  for (const item of cases) {
    const quote = commissionQuote({
      method: item.method,
      configuredValue: item.configuredValue,
      fundSettlementMode: FundSettlementMode.AGENT_NET,
      receivableAmount: 100000,
      confirmedReceived: 40000,
    });
    const cash = orderCashPosition({
      confirmedReceived: 40000,
      receivableAmount: 100000,
      companyCashRefund: 0,
      fundSettlementMode: FundSettlementMode.AGENT_NET,
      commission: { payableAmount: quote.payableAmount, paidAmount: 0 },
    });
    assert.equal(cash.channelSettled, item.settled);
  }
});

test('agent net deduction never exceeds confirmed collection', () => {
  const cash = orderCashPosition({
    confirmedReceived: 400,
    receivableAmount: 1000,
    companyCashRefund: 0,
    fundSettlementMode: FundSettlementMode.AGENT_NET,
    commission: { payableAmount: 2000, paidAmount: 0 },
  });
  assert.deepEqual(cash, {
    channelSettled: 400,
    actualReceived: 0,
    balance: 0,
  });
});

test('blue yidun full agent-net collection produces 22800 cash', () => {
  const cash = orderCashPosition({
    confirmedReceived: 38000,
    receivableAmount: 38000,
    companyCashRefund: 0,
    fundSettlementMode: FundSettlementMode.AGENT_NET,
    commission: { payableAmount: 15200, paidAmount: 15200 },
  });
  assert.deepEqual(cash, {
    channelSettled: 15200,
    actualReceived: 22800,
    balance: 22800,
  });
});

test('company rebate reduces balance only after commission is paid', () => {
  const unpaid = orderCashPosition({
    confirmedReceived: 10000,
    receivableAmount: 10000,
    companyCashRefund: 0,
    fundSettlementMode: FundSettlementMode.COMPANY_REBATE,
    commission: { payableAmount: 1500, paidAmount: 0 },
  });
  assert.deepEqual(unpaid, {
    channelSettled: 0,
    actualReceived: 10000,
    balance: 10000,
  });

  const paid = orderCashPosition({
    confirmedReceived: 10000,
    receivableAmount: 10000,
    companyCashRefund: 0,
    fundSettlementMode: FundSettlementMode.COMPANY_REBATE,
    commission: { payableAmount: 1500, paidAmount: 1500 },
  });
  assert.deepEqual(paid, {
    channelSettled: 1500,
    actualReceived: 10000,
    balance: 8500,
  });
});

test('direct customers keep confirmed cash with no commission deduction', () => {
  const cash = orderCashPosition({
    confirmedReceived: 11000,
    receivableAmount: 11000,
    companyCashRefund: 1000,
    fundSettlementMode: FundSettlementMode.COMPANY_REBATE,
    commission: null,
  });
  assert.deepEqual(cash, {
    channelSettled: 0,
    actualReceived: 11000,
    balance: 10000,
  });
});

test('only completed company-borne cash refunds reduce company balance', () => {
  const amount = companyCashRefunds([
    { status: RefundStatus.REFUNDED, bearer: RefundBearer.COMPANY, cashAmount: 2000 },
    { status: RefundStatus.REFUNDED, bearer: RefundBearer.THIRD_PARTY, cashAmount: 3000 },
    { status: RefundStatus.PENDING, bearer: RefundBearer.COMPANY, cashAmount: 4000 },
  ]);
  assert.equal(amount, 2000);
});

test('refund cash and offset split works for full, partial and zero collection', () => {
  assert.deepEqual(
    refundBreakdown({
      receivableAmount: 1000,
      confirmedReceived: 1000,
      nominalAmount: 300,
    }),
    { cashAmount: 300, offsetAmount: 0 },
  );
  assert.deepEqual(
    refundBreakdown({
      receivableAmount: 1000,
      confirmedReceived: 400,
      nominalAmount: 700,
    }),
    { cashAmount: 100, offsetAmount: 600 },
  );
  assert.deepEqual(
    refundBreakdown({
      receivableAmount: 1000,
      confirmedReceived: 0,
      nominalAmount: 300,
    }),
    { cashAmount: 0, offsetAmount: 300 },
  );
});
