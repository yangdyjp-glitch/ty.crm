import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentConfirmStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommissionsService } from '../commissions/commissions.service';
import { AuthUser } from '../auth/current-user.decorator';
import { customerScopeWhere } from '../common/scope';
import { nextNo } from '../common/util';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private commissions: CommissionsService,
  ) {}

  async create(user: AuthUser, dto: CreatePaymentDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, deletedAt: null, customer: customerScopeWhere(user) },
    });
    if (!order) throw new NotFoundException('订单不存在或无权访问');
    if (
      ([OrderStatus.REFUNDED, OrderStatus.CANCELLED] as OrderStatus[]).includes(
        order.status,
      )
    ) {
      throw new BadRequestException('订单已终止，无法收款');
    }
    return this.prisma.payment.create({
      data: {
        paymentNo: await nextNo(this.prisma.payment, 'paymentNo', 'SK'),
        customerId: order.customerId,
        orderId: order.id,
        amount: dto.amount,
        currency: order.currency,
        method: dto.method,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        confirmStatus: PaymentConfirmStatus.PENDING,
        createdById: user.id,
        remark: dto.remark,
      },
    });
  }

  async confirm(user: AuthUser, id: number) {
    const p = await this.prisma.payment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!p) throw new NotFoundException('收款记录不存在');
    if (p.confirmStatus === PaymentConfirmStatus.CONFIRMED) return p;
    await this.prisma.payment.update({
      where: { id },
      data: {
        confirmStatus: PaymentConfirmStatus.CONFIRMED,
        confirmedById: user.id,
        confirmedAt: new Date(),
      },
    });
    await this.recomputeOrderPaid(p.orderId);
    // 缴清/到账 → 触发分成结算条件检查
    await this.commissions.onPaymentConfirmed(p.orderId);
    return this.prisma.payment.findUnique({ where: { id } });
  }

  /** 重算订单已收/未收与状态（仅统计已确认收款） */
  private async recomputeOrderPaid(orderId: number) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return;
    const agg = await this.prisma.payment.aggregate({
      where: {
        orderId,
        deletedAt: null,
        confirmStatus: PaymentConfirmStatus.CONFIRMED,
      },
      _sum: { amount: true },
    });
    const paid = Number(agg._sum.amount ?? 0);
    const receivable = Number(order.receivableAmount);
    const unpaid = receivable - paid;
    let status = order.status;
    if (
      !(
        [
          OrderStatus.REFUNDED,
          OrderStatus.CANCELLED,
          OrderStatus.IN_SERVICE,
          OrderStatus.COMPLETED,
        ] as OrderStatus[]
      ).includes(order.status)
    ) {
      status =
        unpaid <= 0
          ? OrderStatus.FULLY_PAID
          : paid > 0
            ? OrderStatus.PARTIAL_PAID
            : OrderStatus.PENDING_PAYMENT;
    }
    await this.prisma.order.update({
      where: { id: orderId },
      data: { paidAmount: paid, unpaidAmount: unpaid, status },
    });
  }

  /** 修改待确认收款（已确认的不允许直接改） */
  async update(user: AuthUser, id: number, dto: UpdatePaymentDto) {
    const p = await this.prisma.payment.findFirst({
      where: { id, deletedAt: null, customer: customerScopeWhere(user) },
    });
    if (!p) throw new NotFoundException('收款记录不存在或无权访问');
    if (p.confirmStatus === PaymentConfirmStatus.CONFIRMED) {
      throw new BadRequestException('已确认的收款不允许修改');
    }
    return this.prisma.payment.update({
      where: { id },
      data: {
        amount: dto.amount,
        method: dto.method,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
        remark: dto.remark,
      },
    });
  }

  /** 删除待确认收款（已确认的不允许直接删） */
  async remove(user: AuthUser, id: number) {
    const p = await this.prisma.payment.findFirst({
      where: { id, deletedAt: null, customer: customerScopeWhere(user) },
    });
    if (!p) throw new NotFoundException('收款记录不存在或无权访问');
    if (p.confirmStatus === PaymentConfirmStatus.CONFIRMED) {
      throw new BadRequestException('已确认的收款不允许删除');
    }
    await this.prisma.payment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  list(
    user: AuthUser,
    q: { orderId?: string; confirmStatus?: PaymentConfirmStatus },
  ) {
    const where: Prisma.PaymentWhereInput = {
      deletedAt: null,
      customer: customerScopeWhere(user),
    };
    if (q.orderId) where.orderId = parseInt(q.orderId, 10);
    if (q.confirmStatus) where.confirmStatus = q.confirmStatus;
    return this.prisma.payment.findMany({
      where,
      orderBy: { id: 'desc' },
      include: {
        order: { select: { orderNo: true, receivableAmount: true, paidAmount: true, unpaidAmount: true } },
        customer: { select: { name: true } },
      },
    });
  }

  pending() {
    return this.prisma.payment.findMany({
      where: { deletedAt: null, confirmStatus: PaymentConfirmStatus.PENDING },
      orderBy: { id: 'desc' },
      include: {
        order: { select: { orderNo: true, receivableAmount: true, paidAmount: true, unpaidAmount: true } },
        customer: { select: { name: true } },
      },
    });
  }
}
