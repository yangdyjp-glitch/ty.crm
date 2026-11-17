import { CommissionMethod, CommissionStatus, FundSettlementMode } from '@prisma/client';
import { roundMoney } from './finance';

type CommissionView = {
  status: CommissionStatus;
  fundSettlementMode: FundSettlementMode;
  payableAmount: unknown;
  paidAmount: unknown;
  commissionMethodSnapshot?: CommissionMethod;
  commissionRateSnapshot?: unknown;
  commissionFixedAmountSnapshot?: unknown;
};

/** Display only: never rewrite historical workflow states to describe cash movement. */
export function settlementDisplayStatus(c: CommissionView, confirmedReceived: number): string {
  const payable = Number(c.payableAmount);
  const paid = Number(c.paidAmount);
  if (c.status === CommissionStatus.CANCELLED) return 'CANCELLED';
  if (c.fundSettlementMode === FundSettlementMode.AGENT_NET) {
    if (confirmedReceived <= 0) return 'NOT_RECEIVED';
    if (payable <= 0 && paid <= 0) return 'NO_COMMISSION';
    if (paid <= 0) return 'NOT_DEDUCTED';
    return paid < payable ? 'PARTIALLY_DEDUCTED' : 'SELF_DEDUCTED';
  }
  if (paid > 0) return paid < payable ? 'PARTIALLY_PAID' : 'PAID';
  const configured = c.commissionMethodSnapshot === CommissionMethod.FIXED_AMOUNT
    ? c.commissionFixedAmountSnapshot : c.commissionRateSnapshot;
  if (payable <= 0) {
    return confirmedReceived > 0 || configured != null && Number(configured) === 0
      ? 'NO_COMMISSION' : 'NOT_DUE';
  }
  return c.status === CommissionStatus.PAID ? 'UNPAID' : c.status;
}

export function commissionOutstanding(c: { payableAmount: unknown; paidAmount: unknown; status?: CommissionStatus }) {
  return c.status === CommissionStatus.CANCELLED
    ? 0 : roundMoney(Math.max(0, Number(c.payableAmount) - Number(c.paidAmount)));
}

export function hasSettledCommission(c: {
  status: CommissionStatus; fundSettlementMode: FundSettlementMode;
  payableAmount: unknown; paidAmount: unknown; clawbackAmount: unknown;
  actualSettlementAt?: Date | null; paidById?: number | null; paymentVoucherAttachmentId?: number | null;
}, confirmedReceived = 0) {
  return Number(c.paidAmount) > 0 || Number(c.clawbackAmount) > 0
    || c.status === CommissionStatus.PAID || c.actualSettlementAt != null
    || c.paidById != null || c.paymentVoucherAttachmentId != null
    || c.fundSettlementMode === FundSettlementMode.AGENT_NET && Number(c.payableAmount) > 0 && confirmedReceived > 0;
}

export function cashRebateStatus(
  c: CommissionView | null, confirmedReceived: number, settled: number,
): string {
  if (c?.status === CommissionStatus.CANCELLED) return '已取消';
  // An on-sign rebate can have been paid before the customer's first receipt.
  if (c?.fundSettlementMode === FundSettlementMode.COMPANY_REBATE && settled > 0) {
    return settled < Number(c.payableAmount) ? '已部分返佣' : '已返佣';
  }
  if (confirmedReceived <= 0) return '未到账';
  if (!c || Number(c.payableAmount) <= 0 && settled <= 0) return '无返佣';
  if (c.fundSettlementMode === FundSettlementMode.AGENT_NET) {
    if (settled <= 0) return '未自扣';
    return settled < Number(c.payableAmount) ? '部分自扣' : '已自扣';
  }
  return '未返佣';
}
