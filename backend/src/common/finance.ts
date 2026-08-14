import {
  CommissionMethod,
  FundSettlementMode,
  RefundBearer,
  RefundStatus,
} from '@prisma/client';

export const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function paidRatio(order: {
  paidAmount: unknown;
  receivableAmount: unknown;
}) {
  const receivable = Number(order.receivableAmount);
  if (receivable <= 0) return 0;
  return Math.min(1, Math.max(0, Number(order.paidAmount) / receivable));
}

export function realizedAgentNetCommission(
  commission: { payableAmount: unknown },
  order: { paidAmount: unknown; receivableAmount: unknown },
) {
  return roundMoney(
    Math.min(
      Math.max(0, Number(order.paidAmount)),
      Number(commission.payableAmount) * paidRatio(order),
    ),
  );
}

export function companyCashRefunds(
  refunds?: {
    status: RefundStatus;
    bearer: RefundBearer;
    cashAmount: unknown;
  }[],
) {
  return roundMoney(
    (refunds ?? []).reduce(
      (sum, refund) =>
        refund.status === RefundStatus.REFUNDED &&
        refund.bearer === RefundBearer.COMPANY
          ? sum + Number(refund.cashAmount)
          : sum,
      0,
    ),
  );
}

export function commissionQuote(input: {
  method: CommissionMethod;
  configuredValue: number;
  fundSettlementMode: FundSettlementMode;
  receivableAmount: number;
  confirmedReceived: number;
}) {
  const {
    method,
    configuredValue,
    fundSettlementMode,
    receivableAmount,
    confirmedReceived,
  } = input;

  if (method === CommissionMethod.FIXED_AMOUNT) {
    return {
      calcBaseType: '固定',
      calcBaseAmount: 0,
      payableAmount: roundMoney(configuredValue),
    };
  }

  const useContractAmount =
    method === CommissionMethod.SIGNED_RATIO ||
    fundSettlementMode === FundSettlementMode.AGENT_NET;
  const calcBaseAmount = useContractAmount
    ? receivableAmount
    : confirmedReceived;
  return {
    calcBaseType: useContractAmount
      ? fundSettlementMode === FundSettlementMode.AGENT_NET
        ? '应收(代收)'
        : '签约'
      : '实收',
    calcBaseAmount: roundMoney(calcBaseAmount),
    payableAmount: roundMoney((calcBaseAmount * configuredValue) / 100),
  };
}

export function orderCashPosition(input: {
  confirmedReceived: number;
  receivableAmount: number;
  companyCashRefund: number;
  fundSettlementMode: FundSettlementMode;
  commission?: { payableAmount: unknown; paidAmount: unknown } | null;
}) {
  const {
    confirmedReceived,
    receivableAmount,
    companyCashRefund,
    fundSettlementMode,
    commission,
  } = input;
  let channelSettled = 0;
  let actualReceived = confirmedReceived;

  if (commission) {
    channelSettled =
      fundSettlementMode === FundSettlementMode.AGENT_NET
        ? realizedAgentNetCommission(commission, {
            paidAmount: confirmedReceived,
            receivableAmount,
          })
        : Number(commission.paidAmount || 0);
    if (fundSettlementMode === FundSettlementMode.AGENT_NET) {
      actualReceived = roundMoney(confirmedReceived - channelSettled);
    }
  }

  const balance = roundMoney(
    actualReceived -
      companyCashRefund -
      (fundSettlementMode === FundSettlementMode.COMPANY_REBATE
        ? channelSettled
        : 0),
  );
  return {
    channelSettled: roundMoney(channelSettled),
    actualReceived: roundMoney(actualReceived),
    balance,
  };
}

export function refundBreakdown(input: {
  receivableAmount: number;
  confirmedReceived: number;
  nominalAmount: number;
}) {
  const finalObligation = roundMoney(
    input.receivableAmount - input.nominalAmount,
  );
  const cashAmount = roundMoney(
    Math.min(
      input.nominalAmount,
      Math.max(0, input.confirmedReceived - finalObligation),
    ),
  );
  return {
    cashAmount,
    offsetAmount: roundMoney(input.nominalAmount - cashAmount),
  };
}
