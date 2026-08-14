import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LedgerEntryType,
  OrderStatus,
  Prisma,
  RefundBearer,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { CommissionsService } from '../commissions/commissions.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { customerScopeWhere } from '../common/scope';
import { nextPairedNo } from '../common/util';
import { CreateRefundDto } from './dto/refund.dto';
import { refundBreakdown, roundMoney } from '../common/finance';

@Injectable()
export class RefundsService {
  constructor(
    private prisma: PrismaService,
    private customers: CustomersService,
    private commissions: CommissionsService,
    private ledger: LedgerService,
    private audit: AuditService,
  ) {}

  async create(user: AuthUser, dto: CreateRefundDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, deletedAt: null, customer: customerScopeWhere(user) },
      include: { customer: { select: { customerNo: true, channelId: true } } },
    });
    if (!order) throw new NotFoundException('订单不存在或无权访问');
    if (
      ([OrderStatus.REFUNDED, OrderStatus.CANCELLED] as OrderStatus[]).includes(
        order.status,
      )
    ) {
      throw new BadRequestException('订单已终止，无法退款');
    }
    const activeRefund = await this.prisma.refund.findFirst({
      where: {
        orderId: order.id,
        deletedAt: null,
        status: { in: [RefundStatus.PENDING, RefundStatus.APPROVED, RefundStatus.REFUNDED] },
      },
      select: { refundNo: true },
    });
    if (activeRefund) {
      throw new BadRequestException(
        `该订单已有退款记录 ${activeRefund.refundNo}，不能重复申请`,
      );
    }
    if (
      dto.bearer === RefundBearer.THIRD_PARTY &&
      !order.customer.channelId
    ) {
      throw new BadRequestException('该订单没有第三方渠道，不能选择第三方承担退款');
    }

    const receivable = Number(order.receivableAmount);
    const paid = Number(order.paidAmount);
    let nominal: number;
    let ratio: number;
    if (dto.refundRatio != null) {
      ratio = dto.refundRatio;
      nominal = roundMoney(receivable * ratio);
    } else if (dto.nominalAmount != null) {
      nominal = dto.nominalAmount;
      ratio = receivable > 0 ? nominal / receivable : 0;
    } else {
      throw new BadRequestException('需提供退款比例或退款金额');
    }
    if (nominal <= 0) {
      throw new BadRequestException('退款金额必须大于 0');
    }
    if (nominal > receivable) {
      throw new BadRequestException('退款金额不能大于订单应收金额');
    }
    // 三额：名义 / 实际现金 / 抵减
    const { cashAmount: cash, offsetAmount: offset } = refundBreakdown({
      receivableAmount: receivable,
      confirmedReceived: paid,
      nominalAmount: nominal,
    });

    return this.prisma.refund.create({
      data: {
        refundNo: await nextPairedNo(
          this.prisma.refund,
          'refundNo',
          'TK',
          order.customer.customerNo,
        ),
        customerId: order.customerId,
        orderId: order.id,
        currency: order.currency,
        nominalAmount: nominal,
        cashAmount: cash,
        offsetAmount: offset,
        refundRatio: ratio,
        reason: dto.reason,
        reasonNote: dto.reasonNote,
        status: RefundStatus.PENDING,
        bearer: dto.bearer ?? RefundBearer.COMPANY,
        appliedById: user.id,
        appliedAt: dto.appliedAt ? new Date(dto.appliedAt) : new Date(),
      },
    });
  }

  /** 管理员审核退款：待处理 → 已审核·待支付（不动钱） */
  async approve(user: AuthUser, id: number) {
    const refund = await this.prisma.refund.findFirst({
      where: { id, deletedAt: null },
    });
    if (!refund) throw new NotFoundException('退款记录不存在');
    if (refund.status !== RefundStatus.PENDING) {
      throw new BadRequestException('仅待处理退款可审核');
    }
    return this.prisma.refund.update({
      where: { id },
      data: { status: RefundStatus.APPROVED, reviewedById: user.id },
    });
  }

  /** 管理员支付退款：已审核 → 已退款；终止订单 + 等比例追回佣金 + 第三方垫付入台账 */
  async pay(user: AuthUser, id: number) {
    const refund = await this.prisma.refund.findFirst({
      where: { id, deletedAt: null },
    });
    if (!refund) throw new NotFoundException('退款记录不存在');
    if (refund.status !== RefundStatus.APPROVED) {
      throw new BadRequestException('仅已审核（待支付）退款可支付');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: refund.orderId },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (
      ([OrderStatus.REFUNDED, OrderStatus.CANCELLED] as OrderStatus[]).includes(
        order.status,
      )
    ) {
      throw new BadRequestException('订单已终止，无法重复执行退款');
    }

    await this.prisma.$transaction([
      this.prisma.refund.update({
        where: { id },
        data: { status: RefundStatus.REFUNDED, completedAt: new Date() },
      }),
      // 退款一律终止订单
      this.prisma.order.update({
        where: { id: refund.orderId },
        data: {
          status: OrderStatus.REFUNDED,
          refundAmount: roundMoney(
            Number(order.refundAmount) + Number(refund.nominalAmount),
          ),
        },
      }),
    ]);

    // 佣金等比例追回（含已付→往来挂账）
    const receivable = Number(order.receivableAmount);
    const ratio =
      receivable > 0 ? Number(refund.nominalAmount) / receivable : 0;
    let commissionClawbackAmount = 0;
    if (ratio > 0) {
      const clawback = await this.commissions.clawbackByRatio(refund.orderId, ratio, {
        refundId: id,
        operatorId: user.id,
      });
      commissionClawbackAmount = clawback?.clawAmount ?? 0;
      if (commissionClawbackAmount > 0) {
        await this.prisma.refund.update({
          where: { id },
          data: { commissionClawbackAmount },
        });
      }
    }

    // 第三方垫付退款 → 公司欠第三方（往来台账，负）
    if (refund.bearer === RefundBearer.THIRD_PARTY && Number(refund.cashAmount) > 0) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: refund.customerId },
      });
      if (customer?.channelId) {
        await this.ledger.addEntry({
          channelId: customer.channelId,
          currency: refund.currency,
          entryType: LedgerEntryType.MODE1_ADVANCE_REFUND,
          amount: -Number(refund.cashAmount),
          relatedRefundId: id,
          note: `第三方垫付退款 ${refund.cashAmount}（公司欠第三方）`,
          operatorId: user.id,
        });
      }
    }

    // 客户主状态按订单聚合（退款仅停被退订单）
    await this.customers.recomputeMainStatus(refund.customerId);
    await this.audit.log({
      operatorId: user.id,
      relatedType: 'Refund',
      relatedId: id,
      action: 'PAY_REFUND',
      newValue: `名义=${refund.nominalAmount} 现金=${refund.cashAmount} 抵减=${refund.offsetAmount} 承担=${refund.bearer}`,
    });
    return this.prisma.refund.findUnique({ where: { id } });
  }

  async reject(user: AuthUser, id: number) {
    const refund = await this.prisma.refund.findFirst({
      where: { id, deletedAt: null },
    });
    if (!refund) throw new NotFoundException('退款记录不存在');
    if (refund.status !== RefundStatus.PENDING) {
      throw new BadRequestException('仅待处理退款可拒绝');
    }
    return this.prisma.refund.update({
      where: { id },
      data: { status: RefundStatus.REJECTED, reviewedById: user.id },
    });
  }

  /** 删除退款：仅未执行记录可删除，已退款记录保留财务审计链 */
  async remove(user: AuthUser, id: number) {
    const refund = await this.prisma.refund.findFirst({
      where: { id, deletedAt: null, customer: customerScopeWhere(user) },
    });
    if (!refund) throw new NotFoundException('退款记录不存在或无权访问');
    const wasExecuted = refund.status === RefundStatus.REFUNDED;
    if (wasExecuted) {
      throw new BadRequestException('已退款记录不允许删除');
    }
    await this.prisma.refund.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  list(user: AuthUser, q: { orderId?: string; status?: RefundStatus }) {
    const where: Prisma.RefundWhereInput = {
      deletedAt: null,
      customer: customerScopeWhere(user),
    };
    if (q.orderId) where.orderId = parseInt(q.orderId, 10);
    if (q.status) where.status = q.status;
    return this.prisma.refund.findMany({
      where,
      orderBy: { id: 'desc' },
      include: {
        order: { select: { id: true, orderNo: true } },
        customer: { select: { id: true, name: true } },
      },
    });
  }
}
