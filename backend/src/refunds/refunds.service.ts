import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LedgerEntryType,
  OrderStatus,
  PaymentConfirmStatus,
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
import { nextNo } from '../common/util';
import { CreateRefundDto } from './dto/refund.dto';

const r2 = (n: number) => Math.round(n * 100) / 100;

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
    });
    if (!order) throw new NotFoundException('订单不存在或无权访问');
    if (
      ([OrderStatus.REFUNDED, OrderStatus.CANCELLED] as OrderStatus[]).includes(
        order.status,
      )
    ) {
      throw new BadRequestException('订单已终止，无法退款');
    }

    const receivable = Number(order.receivableAmount);
    const paid = Number(order.paidAmount);
    let nominal: number;
    let ratio: number;
    if (dto.refundRatio != null) {
      ratio = dto.refundRatio;
      nominal = r2(receivable * ratio);
    } else if (dto.nominalAmount != null) {
      nominal = dto.nominalAmount;
      ratio = receivable > 0 ? nominal / receivable : 0;
    } else {
      throw new BadRequestException('需提供退款比例或退款金额');
    }
    // 三额：名义 / 实际现金 / 抵减
    const finalObligation = r2(receivable - nominal); // 客户最终实付目标
    const cash = r2(Math.max(0, paid - finalObligation));
    const offset = r2(nominal - cash);

    return this.prisma.refund.create({
      data: {
        refundNo: await nextNo(this.prisma.refund, 'refundNo', 'TK'),
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
      },
    });
  }

  /** 管理员执行退款：终止订单 + 等比例追回佣金 + 第三方垫付入台账 */
  async approve(user: AuthUser, id: number) {
    const refund = await this.prisma.refund.findFirst({
      where: { id, deletedAt: null },
    });
    if (!refund) throw new NotFoundException('退款记录不存在');
    if (refund.status !== RefundStatus.PENDING) {
      throw new BadRequestException('仅待处理退款可执行');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: refund.orderId },
    });
    if (!order) throw new NotFoundException('订单不存在');

    await this.prisma.$transaction([
      this.prisma.refund.update({
        where: { id },
        data: {
          status: RefundStatus.REFUNDED,
          reviewedById: user.id,
          completedAt: new Date(),
        },
      }),
      // 退款一律终止订单
      this.prisma.order.update({
        where: { id: refund.orderId },
        data: {
          status: OrderStatus.REFUNDED,
          refundAmount: r2(
            Number(order.refundAmount) + Number(refund.nominalAmount),
          ),
        },
      }),
    ]);

    // 佣金等比例追回（含已付→往来挂账）
    const ratio = Number(refund.refundRatio ?? 0);
    if (ratio > 0) {
      await this.commissions.clawbackByRatio(refund.orderId, ratio, {
        refundId: id,
        operatorId: user.id,
      });
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
      action: 'APPROVE_REFUND',
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

  /** 删除退款：待处理/已拒绝直接删；已退款删除会回退订单退款额与状态（佣金/台账不自动回滚，请人工复核） */
  async remove(user: AuthUser, id: number) {
    const refund = await this.prisma.refund.findFirst({
      where: { id, deletedAt: null, customer: customerScopeWhere(user) },
    });
    if (!refund) throw new NotFoundException('退款记录不存在或无权访问');
    const wasExecuted = refund.status === RefundStatus.REFUNDED;
    await this.prisma.refund.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    if (wasExecuted) {
      const order = await this.prisma.order.findUnique({
        where: { id: refund.orderId },
      });
      if (order) {
        const agg = await this.prisma.payment.aggregate({
          where: {
            orderId: refund.orderId,
            deletedAt: null,
            confirmStatus: PaymentConfirmStatus.CONFIRMED,
          },
          _sum: { amount: true },
        });
        const paid = Number(agg._sum.amount ?? 0);
        const unpaid = Number(order.receivableAmount) - paid;
        const status =
          unpaid <= 0
            ? OrderStatus.FULLY_PAID
            : paid > 0
              ? OrderStatus.PARTIAL_PAID
              : OrderStatus.PENDING_PAYMENT;
        await this.prisma.order.update({
          where: { id: refund.orderId },
          data: {
            refundAmount: r2(
              Math.max(0, Number(order.refundAmount) - Number(refund.nominalAmount)),
            ),
            status,
          },
        });
      }
      await this.customers.recomputeMainStatus(refund.customerId);
    }
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
