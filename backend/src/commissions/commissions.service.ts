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
  PaymentConfirmStatus,
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
  paymentCommissionInstallments,
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
      include: {
        customer: { include: { channel: true } },
        payments: { where: { deletedAt: null }, orderBy: { id: 'asc' } },
      },
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
    const eachPayment =
      mode === FundSettlementMode.COMPANY_REBATE &&
      ch.settlementCondition === SettlementCondition.ON_EACH_PAYMENT;
    if (eachPayment && method !== CommissionMethod.NET_RECEIVED_RATIO) {
      throw new BadRequestException('每笔到账后结算仅支持按实收比例返佣');
    }
    const quote = commissionQuote({
      method,
      configuredValue,
      fundSettlementMode: mode,
      receivableAmount: Number(order.receivableAmount),
      confirmedReceived: Number(order.paidAmount),
    });
    const installmentQuote = eachPayment
      ? paymentCommissionInstallments({
          rate: configuredValue,
          paidAmount: 0,
          payments: order.payments,
        })
      : null;
    const calcBaseAmount = eachPayment
      ? roundMoney(
          order.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
        )
      : quote.calcBaseAmount;
    const payableAmount = installmentQuote?.totalPayable ?? quote.payableAmount;

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
          calcBaseAmount,
          payableAmount,
          paidAmount: 0,
          unpaidAmount: payableAmount,
          status: CommissionStatus.SELF_DEDUCTED,
          settlementCondition: ch.settlementCondition,
        },
      });
    } else {
      // 模式二：公司代收返佣 → 走结算流程；按签约比例以应收为基数，否则以实收为基数
      const dueNow =
        ch.settlementCondition === SettlementCondition.ON_SIGN ||
        (eachPayment &&
          order.payments.some(
            (payment) =>
              payment.confirmStatus === PaymentConfirmStatus.CONFIRMED,
          ));
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
          calcBaseAmount,
          payableAmount,
          paidAmount: 0,
          unpaidAmount: payableAmount,
          status: dueNow
            ? CommissionStatus.PENDING_REVIEW
            : CommissionStatus.NOT_DUE,
          settlementCondition: ch.settlementCondition,
          expectedSettlementAt: dueNow ? new Date() : null,
        },
      });
    }
  }

  private eachPaymentState(c: {
    commissionRateSnapshot: unknown;
    paidAmount: unknown;
    clawbackAmount: unknown;
    status: CommissionStatus;
    order: {
      payments: {
        id: number;
        amount: unknown;
        confirmStatus: PaymentConfirmStatus;
        confirmedAt: Date | null;
        paymentNo: string;
        remark: string | null;
        paidAt: Date;
      }[];
    };
  }) {
    const breakdown = paymentCommissionInstallments({
      rate: Number(c.commissionRateSnapshot ?? 0),
      paidAmount: Number(c.paidAmount),
      clawbackAmount: Number(c.clawbackAmount),
      payments: c.order.payments,
    });
    const payments = new Map(c.order.payments.map((payment) => [payment.id, payment]));
    const installments = breakdown.installments.map((installment) => {
      const payment = payments.get(installment.paymentId)!;
      let status: CommissionStatus;
      if (c.status === CommissionStatus.CANCELLED) {
        status = CommissionStatus.CANCELLED;
      } else if (installment.unpaidAmount <= 0 && installment.payableAmount > 0) {
        status = CommissionStatus.PAID;
      } else if (payment.confirmStatus === PaymentConfirmStatus.CONFIRMED) {
        status = CommissionStatus.PENDING_REVIEW;
      } else {
        status = CommissionStatus.NOT_DUE;
      }
      return { ...installment, status, payment };
    });
    const dueInstallment = installments.find(
      (installment) =>
        installment.status === CommissionStatus.PENDING_REVIEW &&
        installment.unpaidAmount > 0,
    );
    let status: CommissionStatus = CommissionStatus.NOT_DUE;
    if (c.status === CommissionStatus.CANCELLED) {
      status = CommissionStatus.CANCELLED;
    } else if (breakdown.totalPayable > 0 && breakdown.unpaidAmount <= 0) {
      status = CommissionStatus.PAID;
    } else if (dueInstallment) {
      status =
        c.status === CommissionStatus.PENDING_PAYMENT
          ? CommissionStatus.PENDING_PAYMENT
          : CommissionStatus.PENDING_REVIEW;
    }
    return { ...breakdown, installments, status, dueInstallment };
  }

  private async syncEachPaymentCommissionById(id: number) {
    const c = await this.prisma.commission.findFirst({
      where: { id, deletedAt: null },
      include: {
        order: {
          include: {
            payments: {
              where: { deletedAt: null },
              orderBy: { id: 'asc' },
            },
          },
        },
      },
    });
    if (
      !c ||
      c.settlementCondition !== SettlementCondition.ON_EACH_PAYMENT ||
      c.fundSettlementMode !== FundSettlementMode.COMPANY_REBATE
    ) {
      return c;
    }
    if (c.commissionMethodSnapshot !== CommissionMethod.NET_RECEIVED_RATIO) {
      throw new BadRequestException('每笔到账后结算仅支持按实收比例返佣');
    }
    const state = this.eachPaymentState(c);
    const calcBaseAmount = roundMoney(
      c.order.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    );
    return this.prisma.commission.update({
      where: { id: c.id },
      data: {
        calcBaseType: '每笔实收',
        calcBaseAmount,
        payableAmount: state.totalPayable,
        unpaidAmount: state.unpaidAmount,
        status: state.status,
        expectedSettlementAt:
          state.dueInstallment?.payment.confirmedAt ??
          (state.dueInstallment ? new Date() : null),
        actualSettlementAt:
          state.status === CommissionStatus.PAID
            ? (c.actualSettlementAt ?? new Date())
            : null,
      },
    });
  }

  async onPaymentPlanChanged(orderId: number) {
    const c = await this.prisma.commission.findUnique({ where: { orderId } });
    if (!c) return;
    await this.syncEachPaymentCommissionById(c.id);
  }

  /** 收款确认后：重算实收基数；满足“缴清后”条件则进入待审核 */
  async onPaymentConfirmed(orderId: number) {
    const c = await this.prisma.commission.findUnique({
      where: { orderId },
      include: { order: true },
    });
    if (!c) return;
    if (c.settlementCondition === SettlementCondition.ON_EACH_PAYMENT) {
      await this.syncEachPaymentCommissionById(c.id);
      return;
    }
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
    const items = await this.prisma.commission.findMany({
      where,
      orderBy: { id: 'desc' },
      include: {
        customer: { select: { name: true } },
        order: {
          select: {
            orderNo: true,
            paidAmount: true,
            receivableAmount: true,
            payments: {
              where: { deletedAt: null },
              orderBy: { id: 'asc' },
              select: {
                id: true,
                paymentNo: true,
                amount: true,
                remark: true,
                paidAt: true,
                confirmStatus: true,
                confirmedAt: true,
              },
            },
          },
        },
      },
    });
    const expandedItems: any[] = items.flatMap<any>((item) => {
      if (
        item.settlementCondition === SettlementCondition.ON_EACH_PAYMENT &&
        item.fundSettlementMode === FundSettlementMode.COMPANY_REBATE &&
        item.commissionMethodSnapshot === CommissionMethod.NET_RECEIVED_RATIO
      ) {
        const state = this.eachPaymentState(item);
        return state.installments.map((installment, installmentIndex) => ({
          ...item,
          recordKey: `commission-${item.id}-payment-${installment.payment.id}`,
          parentStatus: state.status,
          isPaymentInstallment: true,
          installmentIndex,
          paymentId: installment.payment.id,
          paymentNo: installment.payment.paymentNo,
          paymentRemark: installment.payment.remark,
          paymentPaidAt: installment.payment.paidAt,
          paymentConfirmStatus: installment.payment.confirmStatus,
          payableAmount: installment.payableAmount,
          paidAmount: installment.paidAmount,
          unpaidAmount: installment.unpaidAmount,
          status: installment.status,
        }));
      }
      if (item.fundSettlementMode !== FundSettlementMode.AGENT_NET) {
        return [{ ...item, recordKey: `commission-${item.id}` }];
      }
      const paidAmount = realizedAgentNetCommission(item, item.order);
      return [
        {
          ...item,
          recordKey: `commission-${item.id}`,
          paidAmount,
          unpaidAmount: roundMoney(
            Math.max(0, Number(item.payableAmount) - paidAmount),
          ),
        },
      ];
    });
    const filteredItems = q.status
      ? expandedItems.filter((item) => item.status === q.status)
      : expandedItems;
    const pagedItems = showAll
      ? filteredItems
      : filteredItems.slice((page - 1) * pageSize, page * pageSize);
    return {
      items: pagedItems,
      total: filteredItems.length,
      page,
      pageSize,
    };
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
    if (c.settlementCondition === SettlementCondition.ON_EACH_PAYMENT) {
      throw new BadRequestException('按每笔到账结算的返佣请在对应收款行确认支付');
    }
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
    if (c.settlementCondition === SettlementCondition.ON_EACH_PAYMENT) {
      throw new BadRequestException('按每笔到账结算的返佣请在对应收款行确认支付');
    }
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

  /** 按到账记录支付返佣：每次只结清对应的一笔收款返佣。 */
  async payInstallment(
    user: AuthUser,
    id: number,
    paymentId: number,
    voucherAttachmentId?: number,
  ) {
    const c = await this.prisma.commission.findFirst({
      where: { id, deletedAt: null },
      include: {
        order: {
          include: {
            payments: {
              where: { deletedAt: null },
              orderBy: { id: 'asc' },
            },
          },
        },
      },
    });
    if (!c) throw new NotFoundException('分成记录不存在');
    if (
      c.settlementCondition !== SettlementCondition.ON_EACH_PAYMENT ||
      c.fundSettlementMode !== FundSettlementMode.COMPANY_REBATE ||
      c.commissionMethodSnapshot !== CommissionMethod.NET_RECEIVED_RATIO
    ) {
      throw new BadRequestException('该分成不是按每笔到账结算');
    }
    if (c.suspended) throw new BadRequestException('分成已挂起，无法支付');
    const state = this.eachPaymentState(c);
    const installmentIndex = state.installments.findIndex(
      (installment) => installment.paymentId === paymentId,
    );
    if (installmentIndex < 0) {
      throw new BadRequestException('收款记录不属于该分成');
    }
    const installment = state.installments[installmentIndex];
    if (installment.payment.confirmStatus !== PaymentConfirmStatus.CONFIRMED) {
      throw new BadRequestException('对应收款尚未确认到账，不能支付返佣');
    }
    if (installment.unpaidAmount <= 0) {
      throw new BadRequestException('该笔收款的返佣已经支付');
    }
    const earlierDue = state.installments
      .slice(0, installmentIndex)
      .find(
        (item) =>
          item.payment.confirmStatus === PaymentConfirmStatus.CONFIRMED &&
          item.unpaidAmount > 0,
      );
    if (earlierDue) {
      throw new BadRequestException(
        `请先支付较早到账的返佣（${earlierDue.payment.paymentNo}）`,
      );
    }

    const payable = installment.unpaidAmount;
    const balance = await this.ledger.getBalance(c.channelId, c.currency);
    const offset = balance > 0 ? Math.min(payable, balance) : 0;
    const cashOut = roundMoney(payable - offset);
    if (offset > 0) {
      await this.ledger.addEntry({
        channelId: c.channelId,
        currency: c.currency,
        entryType: LedgerEntryType.NEW_ORDER_OFFSET,
        amount: -offset,
        relatedCommissionId: c.id,
        note: `${installment.payment.paymentNo} 返佣抵扣往来挂账 ${offset}`,
        operatorId: user.id,
      });
    }
    const paymentNote = `${installment.payment.paymentNo}返佣：应付${payable}，往来抵扣${offset}，实付现金${cashOut}`;
    await this.prisma.commission.update({
      where: { id: c.id },
      data: {
        paidAmount: roundMoney(Number(c.paidAmount) + payable),
        paidById: user.id,
        paymentVoucherAttachmentId: voucherAttachmentId,
        remark: c.remark ? `${c.remark}\n${paymentNote}` : paymentNote,
      },
    });
    await this.syncEachPaymentCommissionById(c.id);
    await this.audit.log({
      operatorId: user.id,
      relatedType: 'Commission',
      relatedId: id,
      action: 'PAY_COMMISSION_INSTALLMENT',
      newValue: `收款=${installment.payment.paymentNo} 应付=${payable} 往来抵扣=${offset} 实付现金=${cashOut}`,
    });
    return {
      id,
      paymentId,
      paymentNo: installment.payment.paymentNo,
      payable,
      offset,
      cashOut,
    };
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
