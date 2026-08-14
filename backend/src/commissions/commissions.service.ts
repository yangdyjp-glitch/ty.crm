import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CommissionMethod,
  CommissionStatus,
  FundSettlementMode,
  LedgerEntryType,
  Prisma,
  RefundStatus,
  SettlementCondition,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { nextPairedNo } from '../common/util';
import {
  commissionQuote,
  companyCashRefunds,
  orderCashPosition,
  realizedAgentNetCommission,
  roundMoney,
} from '../common/finance';

@Injectable()
export class CommissionsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
  ) {}

  // ============ 生成（实时触发） ============

  /** 订单签约时生成分成记录 */
  async onOrderSigned(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: { include: { channel: true } } },
    });
    if (!order || !order.hasCommission || !order.customer.channel) return;
    const existing = await this.prisma.commission.findUnique({
      where: { orderId },
    });
    if (existing) return;

    const ch = order.customer.channel;
    const method = ch.commissionMethod;
    const configuredValue =
      method === CommissionMethod.FIXED_AMOUNT
        ? Number(ch.defaultCommissionAmount ?? 0)
        : Number(ch.defaultCommissionRate ?? 0);
    const mode = order.fundSettlementMode;
    const quote = commissionQuote({
      method,
      configuredValue,
      fundSettlementMode: mode,
      receivableAmount: Number(order.receivableAmount),
      confirmedReceived: Number(order.paidAmount),
    });

    if (mode === FundSettlementMode.AGENT_NET) {
      // 模式一：第三方代收自扣 → 只记录供报表，终态“已自扣”
      await this.prisma.commission.create({
        data: {
          commissionNo: await nextPairedNo(
            this.prisma.commission,
            'commissionNo',
            'FC',
            order.customer.customerNo,
          ),
          customerId: order.customerId,
          orderId,
          channelId: ch.id,
          currency: order.currency,
          channelNameSnapshot: ch.name,
          commissionMethodSnapshot: method,
          commissionRateSnapshot:
            method === CommissionMethod.FIXED_AMOUNT ? null : configuredValue,
          commissionFixedAmountSnapshot:
            method === CommissionMethod.FIXED_AMOUNT ? configuredValue : null,
          fundSettlementMode: mode,
          calcBaseType: quote.calcBaseType,
          calcBaseAmount: quote.calcBaseAmount,
          payableAmount: quote.payableAmount,
          paidAmount: 0,
          unpaidAmount: quote.payableAmount,
          status: CommissionStatus.SELF_DEDUCTED,
          settlementCondition: ch.settlementCondition,
        },
      });
    } else {
      // 模式二：公司代收返佣 → 走结算流程；按签约比例以应收为基数，否则以实收为基数
      const dueNow = ch.settlementCondition === SettlementCondition.ON_SIGN;
      await this.prisma.commission.create({
        data: {
          commissionNo: await nextPairedNo(
            this.prisma.commission,
            'commissionNo',
            'FC',
            order.customer.customerNo,
          ),
          customerId: order.customerId,
          orderId,
          channelId: ch.id,
          currency: order.currency,
          channelNameSnapshot: ch.name,
          commissionMethodSnapshot: method,
          commissionRateSnapshot:
            method === CommissionMethod.FIXED_AMOUNT ? null : configuredValue,
          commissionFixedAmountSnapshot:
            method === CommissionMethod.FIXED_AMOUNT ? configuredValue : null,
          fundSettlementMode: mode,
          calcBaseType: quote.calcBaseType,
          calcBaseAmount: quote.calcBaseAmount,
          payableAmount: quote.payableAmount,
          paidAmount: 0,
          unpaidAmount: quote.payableAmount,
          status: dueNow
            ? CommissionStatus.PENDING_REVIEW
            : CommissionStatus.NOT_DUE,
          settlementCondition: ch.settlementCondition,
          expectedSettlementAt: dueNow ? new Date() : null,
        },
      });
    }
  }

  /** 收款确认后：重算实收基数；满足“缴清后”条件则进入待审核 */
  async onPaymentConfirmed(orderId: number) {
    const c = await this.prisma.commission.findUnique({
      where: { orderId },
      include: { order: true },
    });
    if (!c) return;
    const configuredValue =
      c.commissionMethodSnapshot === CommissionMethod.FIXED_AMOUNT
        ? Number(
            c.commissionFixedAmountSnapshot ??
              Number(c.payableAmount) + Number(c.clawbackAmount),
          )
        : Number(c.commissionRateSnapshot ?? 0);
    const quote = commissionQuote({
      method: c.commissionMethodSnapshot,
      configuredValue,
      fundSettlementMode: c.fundSettlementMode,
      receivableAmount: Number(c.order.receivableAmount),
      confirmedReceived: Number(c.order.paidAmount),
    });
    const payable = roundMoney(
      Math.max(0, quote.payableAmount - Number(c.clawbackAmount)),
    );
    if (c.fundSettlementMode === FundSettlementMode.AGENT_NET) {
      const paidAmount = realizedAgentNetCommission(
        { payableAmount: payable },
        c.order,
      );
      await this.prisma.commission.update({
        where: { id: c.id },
        data: {
          calcBaseType: quote.calcBaseType,
          calcBaseAmount: quote.calcBaseAmount,
          payableAmount: payable,
          paidAmount,
          unpaidAmount: roundMoney(Math.max(0, payable - paidAmount)),
        },
      });
      return;
    }
    if (
      (
        [CommissionStatus.PAID, CommissionStatus.CANCELLED] as CommissionStatus[]
      ).includes(c.status)
    )
      return;

    let status = c.status;
    let expected = c.expectedSettlementAt;
    if (
      c.settlementCondition === SettlementCondition.ON_FULL_PAYMENT &&
      Number(c.order.unpaidAmount) <= 0 &&
      c.status === CommissionStatus.NOT_DUE
    ) {
      status = CommissionStatus.PENDING_REVIEW;
      expected = new Date();
    }
    await this.prisma.commission.update({
      where: { id: c.id },
      data: {
        calcBaseType: quote.calcBaseType,
        calcBaseAmount: quote.calcBaseAmount,
        payableAmount: payable,
        unpaidAmount: roundMoney(
          Math.max(0, payable - Number(c.paidAmount)),
        ),
        status,
        expectedSettlementAt: expected,
      },
    });
  }

  /** 服务完成后：满足“服务完成后”条件则进入待审核并定稿应付 */
  async onServiceCompleted(orderId: number) {
    await this.onPaymentConfirmed(orderId);
    const c = await this.prisma.commission.findUnique({
      where: { orderId },
    });
    if (!c || c.fundSettlementMode === FundSettlementMode.AGENT_NET) return;
    if (
      (
        [CommissionStatus.PAID, CommissionStatus.CANCELLED] as CommissionStatus[]
      ).includes(c.status)
    )
      return;
    if (
      c.settlementCondition === SettlementCondition.ON_SERVICE_COMPLETE &&
      c.status === CommissionStatus.NOT_DUE
    ) {
      await this.prisma.commission.update({
        where: { id: c.id },
        data: {
          status: CommissionStatus.PENDING_REVIEW,
          expectedSettlementAt: new Date(),
        },
      });
    }
  }

  async onOrderAmountChanged(orderId: number) {
    await this.onPaymentConfirmed(orderId);
  }

  // ============ 结算工作流（管理员，仅模式二） ============

  async list(q: {
    channelId?: string;
    status?: CommissionStatus;
    all?: string;
    page?: string;
    pageSize?: string;
  }) {
    const showAll = q.all === '1' || q.all === 'true';
    const page = Math.max(1, parseInt(q.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize || '20', 10)));
    const where: Prisma.CommissionWhereInput = { deletedAt: null };
    if (q.channelId) where.channelId = parseInt(q.channelId, 10);
    if (q.status) where.status = q.status;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.commission.findMany({
        where,
        orderBy: { id: 'desc' },
        ...(showAll ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
        include: {
          customer: { select: { name: true } },
          order: { select: { orderNo: true, paidAmount: true, receivableAmount: true } },
        },
      }),
      this.prisma.commission.count({ where }),
    ]);
    const normalizedItems = items.map((item) => {
      if (item.fundSettlementMode !== FundSettlementMode.AGENT_NET) return item;
      const paidAmount = realizedAgentNetCommission(item, item.order);
      return {
        ...item,
        paidAmount,
        unpaidAmount: roundMoney(
          Math.max(0, Number(item.payableAmount) - paidAmount),
        ),
      };
    });
    return { items: normalizedItems, total, page, pageSize };
  }

  async cashAccounts(q: { all?: string; page?: string; pageSize?: string }) {
    const showAll = q.all === '1' || q.all === 'true';
    const page = Math.max(1, parseInt(q.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize || '20', 10)));
    const where: Prisma.OrderWhereInput = { deletedAt: null };
    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { id: 'desc' },
        ...(showAll ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
        include: {
          customer: {
            select: {
              name: true,
              channelNameSnapshot: true,
              channel: { select: { name: true } },
            },
          },
          commission: true,
          refunds: {
            where: { deletedAt: null, status: RefundStatus.REFUNDED },
            select: { status: true, bearer: true, cashAmount: true },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    const items = orders.map((order) => {
      const commission =
        order.commission && !order.commission.deletedAt ? order.commission : null;
      const contractAmount = Number(order.receivableAmount);
      const payableAmount = Number(commission?.payableAmount ?? 0);
      const confirmedReceived = Number(order.paidAmount);
      const cashRefund = companyCashRefunds(order.refunds);
      const fundSettlementMode =
        commission?.fundSettlementMode ?? order.fundSettlementMode;
      const cash = orderCashPosition({
        confirmedReceived,
        receivableAmount: contractAmount,
        companyCashRefund: cashRefund,
        fundSettlementMode,
        commission,
      });
      let rebateStatus = '未到账';

      if (confirmedReceived > 0) {
        if (!commission) {
          rebateStatus = '无返佣';
        } else if (fundSettlementMode === FundSettlementMode.AGENT_NET) {
          const deducted = cash.channelSettled;
          rebateStatus =
            deducted <= 0
              ? '未到账'
              : deducted >= payableAmount
                ? '已自扣'
                : '部分自扣';
        } else {
          if (commission.status === CommissionStatus.PAID) {
            rebateStatus = '已返佣';
          } else if (Number(commission.paidAmount) > 0) {
            rebateStatus = '部分返佣';
          } else {
            rebateStatus = '未返佣';
          }
        }
      }

      return {
        orderId: order.id,
        customerName: order.customer.name,
        channelName:
          commission?.channelNameSnapshot ||
          order.customer.channelNameSnapshot ||
          order.customer.channel?.name ||
          '—',
        rebateStatus,
        fundSettlementMode,
        currency: order.currency,
        contractAmount: roundMoney(contractAmount),
        actualReceived: cash.actualReceived,
        balance: cash.balance,
      };
    });

    return { items, total, page, pageSize };
  }

  private async load(id: number) {
    const c = await this.prisma.commission.findFirst({
      where: { id, deletedAt: null },
    });
    if (!c) throw new NotFoundException('分成记录不存在');
    return c;
  }

  async review(id: number) {
    const c = await this.load(id);
    if (c.suspended) throw new BadRequestException('分成已挂起，请先解除挂起');
    if (c.status !== CommissionStatus.PENDING_REVIEW) {
      throw new BadRequestException('仅待审核分成可审核');
    }
    return this.prisma.commission.update({
      where: { id },
      data: { status: CommissionStatus.PENDING_PAYMENT },
    });
  }

  /** 支付分成：先用渠道往来挂账（第三方欠公司）抵扣，再付净额 */
  async pay(user: AuthUser, id: number, voucherAttachmentId?: number) {
    const c = await this.load(id);
    if (c.suspended) throw new BadRequestException('分成已挂起，无法支付');
    if (
      c.status !== CommissionStatus.PENDING_REVIEW &&
      c.status !== CommissionStatus.PENDING_PAYMENT
    ) {
      throw new BadRequestException('仅待审核 / 待支付分成可结算');
    }
    const payable = Number(c.payableAmount);
    const balance = await this.ledger.getBalance(c.channelId, c.currency);
    const outstanding = roundMoney(
      Math.max(0, payable - Number(c.paidAmount)),
    );
    if (outstanding <= 0) {
      throw new BadRequestException('该分成没有待支付金额');
    }
    const offset = balance > 0 ? Math.min(outstanding, balance) : 0;
    const cashOut = roundMoney(outstanding - offset);
    if (offset > 0) {
      await this.ledger.addEntry({
        channelId: c.channelId,
        currency: c.currency,
        entryType: LedgerEntryType.NEW_ORDER_OFFSET,
        amount: -offset,
        relatedCommissionId: c.id,
        note: `新单佣金抵扣往来挂账 ${offset}`,
        operatorId: user.id,
      });
    }
    await this.prisma.commission.update({
      where: { id },
      data: {
        status: CommissionStatus.PAID,
        paidAmount: payable,
        unpaidAmount: 0,
        actualSettlementAt: new Date(),
        paidById: user.id,
        paymentVoucherAttachmentId: voucherAttachmentId,
        remark: offset > 0 ? `含往来抵扣 ${offset}，实付现金 ${cashOut}` : null,
      },
    });
    await this.audit.log({
      operatorId: user.id,
      relatedType: 'Commission',
      relatedId: id,
      action: 'PAY_COMMISSION',
      newValue: `应付=${payable} 往来抵扣=${offset} 实付现金=${cashOut}`,
    });
    return { id, payable, offset, cashOut };
  }

  async suspend(id: number, note?: string) {
    await this.load(id);
    return this.prisma.commission.update({
      where: { id },
      data: { suspended: true, problemNote: note },
    });
  }

  async resume(id: number) {
    await this.load(id);
    return this.prisma.commission.update({
      where: { id },
      data: { suspended: false },
    });
  }

  async cancel(id: number) {
    await this.load(id);
    return this.prisma.commission.update({
      where: { id },
      data: { status: CommissionStatus.CANCELLED, unpaidAmount: 0 },
    });
  }

  async remove(id: number) {
    await this.load(id);
    return this.prisma.commission.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // 批量审核 / 批量支付（结算页批量操作）
  async batchReview(ids: number[]) {
    let ok = 0;
    for (const id of ids) {
      try {
        await this.review(id);
        ok++;
      } catch {
        /* 跳过不满足条件的 */
      }
    }
    return { reviewed: ok, total: ids.length };
  }

  async batchPay(user: AuthUser, ids: number[]) {
    const results: { id: number; payable: number; offset: number; cashOut: number }[] = [];
    for (const id of ids) {
      try {
        results.push(await this.pay(user, id));
      } catch {
        /* 跳过 */
      }
    }
    return { paid: results.length, total: ids.length, results };
  }

  // ============ 退款等比例追回（供退款流程调用） ============

  /**
   * 按退款比例等比例追回该订单佣金。
   * - 未支付（模式二）：直接按比例减少应付。
   * - 已支付（模式二）：公司已垫付 → 生成往来挂账（第三方欠公司），待新单抵扣。
   * - 模式一（已自扣）：按比例减少报表佣金（第三方各退各的，不入往来）。
   */
  async clawbackByRatio(
    orderId: number,
    ratio: number,
    opts: { refundId?: number; operatorId?: number },
  ) {
    const c = await this.prisma.commission.findUnique({
      where: { orderId },
      include: { order: true },
    });
    if (!c) return null;
    const origPayable = Number(c.payableAmount);
    const clawAmount = roundMoney(origPayable * ratio);
    if (clawAmount <= 0) return null;

    const newClawback = roundMoney(Number(c.clawbackAmount) + clawAmount);

    if (
      c.fundSettlementMode === FundSettlementMode.COMPANY_REBATE &&
      c.status === CommissionStatus.PAID
    ) {
      // 已付：公司垫付 → 第三方欠公司 → 往来挂账（正），待新单抵扣
      await this.ledger.addEntry({
        channelId: c.channelId,
        currency: c.currency,
        entryType: LedgerEntryType.MODE2_ADVANCE_COMMISSION,
        amount: clawAmount,
        relatedRefundId: opts.refundId,
        relatedCommissionId: c.id,
        note: `退款等比例追回已付佣金 ${clawAmount}（第三方欠公司）`,
        operatorId: opts.operatorId,
      });
      await this.prisma.commission.update({
        where: { id: c.id },
        data: { clawbackAmount: newClawback },
      });
    } else {
      // 未付 或 模式一：直接减少应付/报表佣金
      const newPayable = roundMoney(Math.max(0, origPayable - clawAmount));
      const paidAmount =
        c.fundSettlementMode === FundSettlementMode.AGENT_NET
          ? realizedAgentNetCommission({ payableAmount: newPayable }, c.order)
          : Number(c.paidAmount);
      await this.prisma.commission.update({
        where: { id: c.id },
        data: {
          payableAmount: newPayable,
          paidAmount,
          unpaidAmount: roundMoney(Math.max(0, newPayable - paidAmount)),
          clawbackAmount: newClawback,
        },
      });
    }
    return { clawAmount };
  }
}
