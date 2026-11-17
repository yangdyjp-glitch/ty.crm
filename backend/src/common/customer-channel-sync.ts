import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  CommissionMethod, CommissionStatus, FundSettlementMode, OrderStatus,
  PaymentConfirmStatus, Prisma, SettlementCondition,
} from '@prisma/client';
import { commissionQuote, paymentCommissionInstallments, roundMoney } from './finance';
import { nextPairedNo } from './util';

/** Called inside the customer update transaction, with the customer row locked. */
export async function syncCustomerChannel(
  tx: Prisma.TransactionClient,
  customer: { id: number; customerNo: string; channelId: number | null },
  operatorId: number,
) {
  const channel = customer.channelId == null ? null : await tx.channel.findFirst({
    where: { id: customer.channelId, deletedAt: null },
  });
  if (customer.channelId != null && !channel) throw new BadRequestException('渠道不存在');

  // Receipt confirmation and commission payment must not cross the reattribution.
  await tx.$queryRaw`SELECT id FROM "Order" WHERE "customerId" = ${customer.id} AND "deletedAt" IS NULL ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE "customerId" = ${customer.id} AND "deletedAt" IS NULL ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Commission" WHERE "customerId" = ${customer.id} ORDER BY id FOR UPDATE`;
  const orders = await tx.order.findMany({
    where: { customerId: customer.id, deletedAt: null },
    orderBy: { id: 'asc' },
    include: {
      product: { select: { participateCommission: true } },
      commission: true,
      payments: { where: { deletedAt: null }, orderBy: { id: 'asc' } },
      refunds: { where: { deletedAt: null } },
    },
  });
  if (!orders.length) return;
  const ledgerEntries = await tx.channelLedger.findMany({
    where: { OR: [
      { relatedOrderId: { in: orders.map((o) => o.id) } },
      { relatedCommissionId: { in: orders.flatMap((o) => o.commission ? [o.commission.id] : []) } },
      { relatedRefundId: { in: orders.flatMap((o) => o.refunds.map((r) => r.id)) } },
    ] },
    select: { relatedOrderId: true, relatedCommissionId: true, relatedRefundId: true },
  });
  const mode = channel?.fundSettlementMode ?? FundSettlementMode.COMPANY_DIRECT;
  const plans = orders.map((order) => {
    const c = order.commission;
    const hasCommission = !!channel && (order.hasCommission || !!c || order.product.participateCommission);
    const confirmedReceived = roundMoney(order.payments.reduce((sum, payment) =>
      sum + (payment.confirmStatus === PaymentConfirmStatus.CONFIRMED ? Number(payment.amount) : 0), 0));
    if (confirmedReceived !== Number(order.paidAmount)) {
      throw new ConflictException(`订单 ${order.orderNo} 收款正在更新，请刷新后重试`);
    }
    const hasLedger = ledgerEntries.some((entry) => entry.relatedOrderId === order.id
      || c != null && entry.relatedCommissionId === c.id
      || order.refunds.some((r) => entry.relatedRefundId === r.id));
    const hasHistory = hasLedger || order.refunds.length > 0 || Number(order.refundAmount) > 0
      || order.status === OrderStatus.REFUNDED || order.status === OrderStatus.CANCELLED
      || c != null && (c.deletedAt != null || c.suspended || c.status === CommissionStatus.CANCELLED
        || c.status === CommissionStatus.PAID || Number(c.paidAmount) > 0 || Number(c.clawbackAmount) > 0
        || c.actualSettlementAt != null || c.paidById != null || c.paymentVoucherAttachmentId != null
        // SELF_DEDUCTED alone does not mean money was received or actually deducted.
        || c.fundSettlementMode === FundSettlementMode.AGENT_NET && confirmedReceived > 0)
      || confirmedReceived > 0 && (order.fundSettlementMode !== mode || hasCommission && !c
        || c != null && c.fundSettlementMode !== order.fundSettlementMode);
    if (hasHistory) {
      throw new BadRequestException(`订单 ${order.orderNo} 涉及已支付、已代扣、退款、台账或已终止的结算记录，请先核对历史分成调整预览；客户渠道尚未修改`);
    }

    if (!channel || !hasCommission) return { order, hasCommission, data: null };
    const method = channel.commissionMethod;
    const configured = method === CommissionMethod.FIXED_AMOUNT
      ? channel.defaultCommissionAmount : channel.defaultCommissionRate;
    if (configured == null || !Number.isFinite(Number(configured)) || Number(configured) < 0
      || method !== CommissionMethod.FIXED_AMOUNT && Number(configured) > 100) {
      throw new BadRequestException('请先在渠道管理中设置有效的默认返佣');
    }
    if (method === CommissionMethod.FIXED_AMOUNT && Number(configured) > Number(order.receivableAmount)) {
      throw new BadRequestException(`订单 ${order.orderNo} 的固定返佣不能超过应收金额`);
    }
    if (mode === FundSettlementMode.COMPANY_DIRECT) throw new BadRequestException('第三方渠道不能使用公司直收模式');
    const eachPayment = channel.settlementCondition === SettlementCondition.ON_EACH_PAYMENT;
    if (eachPayment && (mode !== FundSettlementMode.COMPANY_REBATE || method !== CommissionMethod.NET_RECEIVED_RATIO)) {
      throw new BadRequestException('每笔到账后结算仅支持公司代收、按实收比例返佣');
    }
    const quote = commissionQuote({
      method, configuredValue: Number(configured), fundSettlementMode: mode,
      receivableAmount: Number(order.receivableAmount), confirmedReceived,
    });
    const payableAmount = eachPayment ? paymentCommissionInstallments({
      rate: Number(configured), paidAmount: 0, payments: order.payments,
    }).totalPayable : quote.payableAmount;
    const due = channel.settlementCondition === SettlementCondition.ON_SIGN
      || channel.settlementCondition === SettlementCondition.ON_FULL_PAYMENT && Number(order.unpaidAmount) <= 0
      || channel.settlementCondition === SettlementCondition.ON_SERVICE_COMPLETE && order.status === OrderStatus.COMPLETED
      || eachPayment && order.payments.some((p) => p.confirmStatus === PaymentConfirmStatus.CONFIRMED);
    const data = {
      channelId: channel.id,
      channelNameSnapshot: channel.name,
      commissionMethodSnapshot: method,
      commissionRateSnapshot: method === CommissionMethod.FIXED_AMOUNT ? null : Number(configured),
      commissionFixedAmountSnapshot: method === CommissionMethod.FIXED_AMOUNT ? Number(configured) : null,
      fundSettlementMode: mode,
      settlementCondition: channel.settlementCondition,
      calcBaseType: eachPayment ? '每笔实收' : quote.calcBaseType,
      calcBaseAmount: eachPayment ? roundMoney(order.payments.reduce((sum, p) => sum + Number(p.amount), 0)) : quote.calcBaseAmount,
      payableAmount, unpaidAmount: payableAmount,
      status: mode === FundSettlementMode.AGENT_NET ? CommissionStatus.SELF_DEDUCTED
        : due ? CommissionStatus.PENDING_REVIEW : CommissionStatus.NOT_DUE,
      expectedSettlementAt: mode !== FundSettlementMode.AGENT_NET && due ? new Date() : null,
      // Approval for the previous recipient is not approval for the new recipient.
      reviewedById: null,
    };
    return { order, hasCommission, data };
  });

  // All affected orders are checked before any record is changed.
  for (const { order, hasCommission, data } of plans) {
    const c = order.commission;
    if (order.fundSettlementMode !== mode || order.hasCommission !== hasCommission) {
      const orderData = { fundSettlementMode: mode, hasCommission };
      await tx.order.update({ where: { id: order.id }, data: orderData });
      await tx.auditLog.create({ data: {
        operatorId, relatedType: 'Order', relatedId: order.id, action: 'SYNC_CUSTOMER_CHANNEL',
        oldValue: JSON.stringify({ fundSettlementMode: order.fundSettlementMode, hasCommission: order.hasCommission }),
        newValue: JSON.stringify(orderData), reason: '客户渠道变更，同步订单结算方式',
      } });
    }
    let updated;
    if (data && c) {
      updated = await tx.commission.update({ where: { id: c.id }, data });
    } else if (data) {
      updated = await tx.commission.create({ data: {
        ...data, customerId: customer.id, orderId: order.id, currency: order.currency,
        commissionNo: await nextPairedNo(tx.commission, 'commissionNo', 'FC', customer.customerNo),
      } });
    } else if (c) {
      updated = await tx.commission.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
    }
    if (updated) await tx.auditLog.create({ data: {
      operatorId, relatedType: 'Commission', relatedId: updated.id, action: 'SYNC_CUSTOMER_CHANNEL',
      oldValue: c ? JSON.stringify(c) : null, newValue: JSON.stringify(updated),
      reason: `客户 ${customer.customerNo} 渠道变更，同步尚未结算的分成`,
    } });
  }
}
