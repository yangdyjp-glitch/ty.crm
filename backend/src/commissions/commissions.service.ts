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
  OrderStatus,
  Prisma,
  SettlementCondition,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { nextNo } from '../common/util';

const r2 = (n: number) => Math.round(n * 100) / 100;

function computePayable(
  method: CommissionMethod,
  rateOrAmount: number,
  base: number,
): number {
  return method === CommissionMethod.FIXED_AMOUNT
    ? r2(rateOrAmount)
    : r2((base * rateOrAmount) / 100); // 实收比例 / 签约比例 同公式，基数不同
}

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
    const rateOrAmount = ch.defaultCommissionRate
      ? Number(ch.defaultCommissionRate)
      : 0;
    const mode = order.fundSettlementMode;

    if (mode === FundSettlementMode.AGENT_NET) {
      // 模式一：第三方代收自扣 → 只记录供报表，终态“已自扣”
      const base = Number(order.receivableAmount);
      const payable = computePayable(method, rateOrAmount, base);
      await this.prisma.commission.create({
        data: {
          commissionNo: await nextNo(this.prisma.commission, 'commissionNo', 'FC'),
          customerId: order.customerId,
          orderId,
          channelId: ch.id,
          currency: order.currency,
          channelNameSnapshot: ch.name,
          commissionMethodSnapshot: method,
          commissionRateSnapshot: rateOrAmount,
          fundSettlementMode: mode,
          calcBaseType:
            method === CommissionMethod.NET_RECEIVED_RATIO ? '应收(代收)' : '固定',
          calcBaseAmount: base,
          payableAmount: payable,
          paidAmount: payable,
          unpaidAmount: 0,
          status: CommissionStatus.SELF_DEDUCTED,
          settlementCondition: ch.settlementCondition,
        },
      });
    } else {
      // 模式二：公司代收返佣 → 走结算流程；按签约比例以应收为基数，否则以实收为基数
      const base =
        method === CommissionMethod.SIGNED_RATIO
          ? Number(order.receivableAmount)
          : Number(order.paidAmount);
      const payable = computePayable(method, rateOrAmount, base);
      const dueNow = ch.settlementCondition === SettlementCondition.ON_SIGN;
      await this.prisma.commission.create({
        data: {
          commissionNo: await nextNo(this.prisma.commission, 'commissionNo', 'FC'),
          customerId: order.customerId,
          orderId,
          channelId: ch.id,
          currency: order.currency,
          channelNameSnapshot: ch.name,
          commissionMethodSnapshot: method,
          commissionRateSnapshot: rateOrAmount,
          fundSettlementMode: mode,
          calcBaseType:
            method === CommissionMethod.FIXED_AMOUNT
              ? '固定'
              : method === CommissionMethod.SIGNED_RATIO
                ? '签约'
                : '实收',
          calcBaseAmount: base,
          payableAmount: payable,
          paidAmount: 0,
          unpaidAmount: payable,
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
    if (!c || c.fundSettlementMode === FundSettlementMode.AGENT_NET) return;
    if (
      (
        [CommissionStatus.PAID, CommissionStatus.CANCELLED] as CommissionStatus[]
      ).includes(c.status)
    )
      return;

    let payable = Number(c.payableAmount);
    let base = Number(c.calcBaseAmount);
    if (c.commissionMethodSnapshot === CommissionMethod.NET_RECEIVED_RATIO) {
      base = Number(c.order.paidAmount);
      payable = r2((base * Number(c.commissionRateSnapshot)) / 100);
    }
    let status = c.status;
    let expected = c.expectedSettlementAt;
    if (
      c.settlementCondition === SettlementCondition.ON_FULL_PAYMENT &&
      c.order.status === OrderStatus.FULLY_PAID &&
      c.status === CommissionStatus.NOT_DUE
    ) {
      status = CommissionStatus.PENDING_REVIEW;
      expected = new Date();
    }
    await this.prisma.commission.update({
      where: { id: c.id },
      data: {
        calcBaseAmount: base,
        payableAmount: payable,
        unpaidAmount: r2(payable - Number(c.paidAmount)),
        status,
        expectedSettlementAt: expected,
      },
    });
  }

  /** 服务完成后：满足“服务完成后”条件则进入待审核并定稿应付 */
  async onServiceCompleted(orderId: number) {
    const c = await this.prisma.commission.findUnique({
      where: { orderId },
      include: { order: true },
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
      let payable = Number(c.payableAmount);
      if (c.commissionMethodSnapshot === CommissionMethod.NET_RECEIVED_RATIO) {
        payable = r2(
          (Number(c.order.paidAmount) * Number(c.commissionRateSnapshot)) / 100,
        );
      }
      await this.prisma.commission.update({
        where: { id: c.id },
        data: {
          status: CommissionStatus.PENDING_REVIEW,
          expectedSettlementAt: new Date(),
          payableAmount: payable,
          unpaidAmount: r2(payable - Number(c.paidAmount)),
        },
      });
    }
  }

  // ============ 结算工作流（管理员，仅模式二） ============

  async list(q: {
    channelId?: string;
    status?: CommissionStatus;
    page?: string;
    pageSize?: string;
  }) {
    const page = Math.max(1, parseInt(q.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize || '20', 10)));
    const where: Prisma.CommissionWhereInput = { deletedAt: null };
    if (q.channelId) where.channelId = parseInt(q.channelId, 10);
    if (q.status) where.status = q.status;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.commission.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { name: true } },
          order: { select: { orderNo: true } },
        },
      }),
      this.prisma.commission.count({ where }),
    ]);
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
    if (c.status !== CommissionStatus.PENDING_PAYMENT) {
      throw new BadRequestException('仅待支付分成可支付');
    }
    const payable = Number(c.payableAmount);
    const balance = await this.ledger.getBalance(c.channelId, c.currency);
    const offset = balance > 0 ? Math.min(payable, balance) : 0;
    const cashOut = r2(payable - offset);
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
    const c = await this.prisma.commission.findUnique({ where: { orderId } });
    if (!c) return null;
    const origPayable = Number(c.payableAmount);
    const clawAmount = r2(origPayable * ratio);
    if (clawAmount <= 0) return null;

    const newClawback = r2(Number(c.clawbackAmount) + clawAmount);

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
      const newPayable = r2(Math.max(0, origPayable - clawAmount));
      await this.prisma.commission.update({
        where: { id: c.id },
        data: {
          payableAmount: newPayable,
          unpaidAmount: r2(Math.max(0, newPayable - Number(c.paidAmount))),
          clawbackAmount: newClawback,
        },
      });
    }
    return { clawAmount };
  }
}
