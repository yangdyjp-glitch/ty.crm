import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FundSettlementMode,
  OrderStatus,
  PaymentConfirmStatus,
  Prisma,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { CommissionsService } from '../commissions/commissions.service';
import { AuthUser } from '../auth/current-user.decorator';
import { customerScopeWhere } from '../common/scope';
import { nextNo } from '../common/util';
import { CreateOrderDto, UpdateOrderDto } from './dto/order.dto';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private customers: CustomersService,
    private commissions: CommissionsService,
  ) {}

  async create(user: AuthUser, dto: CreateOrderDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, deletedAt: null, ...customerScopeWhere(user) },
      include: { channel: true },
    });
    if (!customer) throw new NotFoundException('客户不存在或无权访问');
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, deletedAt: null },
    });
    if (!product) throw new BadRequestException('项目不存在');

    const fundMode =
      dto.fundSettlementMode ??
      customer.channel?.fundSettlementMode ??
      FundSettlementMode.COMPANY_REBATE;
    const hasCommission = !!customer.channelId && product.participateCommission;
    const discount = dto.discountAmount ?? 0;
    const receivable = dto.originalPrice - discount;

    const orderNo = await nextNo(this.prisma.order, 'orderNo', 'DD');
    const contractNo = dto.contractNo || (await nextNo(this.prisma.order, 'contractNo', 'HT'));
    const firstPayNo = await nextNo(this.prisma.payment, 'paymentNo', 'SK');
    const hasTail = !!dto.tailPaymentAmount && dto.tailPaymentAmount > 0;
    // 尾款编号取首款 +1（同事务内顺延，避免重复查询撞号）
    const tailPayNo = hasTail
      ? 'SK' + String(parseInt(firstPayNo.slice(2), 10) + 1).padStart(6, '0')
      : null;

    const order = await this.prisma.$transaction(async (tx) => {
      const o = await tx.order.create({
        data: {
          orderNo,
          customerId: dto.customerId,
          productId: dto.productId,
          currency: dto.currency,
          fundSettlementMode: fundMode,
          signedById: user.id,
          signedAt: dto.signedAt ? new Date(dto.signedAt) : new Date(),
          contractNo, // 自动合同号
          originalPrice: dto.originalPrice,
          discountAmount: discount,
          receivableAmount: receivable,
          paidAmount: 0,
          unpaidAmount: receivable,
          status: OrderStatus.PENDING_PAYMENT,
          hasCommission,
          remark: dto.remark,
        },
      });
      // 首款（必填）→ 一条待确认收款
      await tx.payment.create({
        data: {
          paymentNo: firstPayNo,
          customerId: dto.customerId,
          orderId: o.id,
          amount: dto.firstPaymentAmount,
          currency: dto.currency,
          method: dto.firstPaymentMethod,
          paidAt: dto.firstPaymentPaidAt
            ? new Date(dto.firstPaymentPaidAt)
            : new Date(),
          confirmStatus: PaymentConfirmStatus.PENDING,
          createdById: user.id,
          remark: '首款',
        },
      });
      // 尾款（选填）→ 再加一条待确认收款
      if (hasTail) {
        await tx.payment.create({
          data: {
            paymentNo: tailPayNo!,
            customerId: dto.customerId,
            orderId: o.id,
            amount: dto.tailPaymentAmount!,
            currency: dto.currency,
            paidAt: new Date(),
            confirmStatus: PaymentConfirmStatus.PENDING,
            createdById: user.id,
            remark: '尾款',
          },
        });
      }
      return o;
    });

    // 客户主状态按订单聚合（新签约 → 已签约）
    await this.customers.recomputeMainStatus(dto.customerId);
    // 实时生成上游分成（模式一记录自扣 / 模式二进入结算流程）
    await this.commissions.onOrderSigned(order.id);
    return this.get(user, order.id);
  }

  async list(
    user: AuthUser,
    q: { customerId?: string; status?: OrderStatus; page?: string; pageSize?: string },
  ) {
    const page = Math.max(1, parseInt(q.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize || '20', 10)));
    const where: Prisma.OrderWhereInput = {
      deletedAt: null,
      customer: customerScopeWhere(user),
    };
    if (q.customerId) where.customerId = parseInt(q.customerId, 10);
    if (q.status) where.status = q.status;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { id: true, name: true, customerNo: true } },
          product: { select: { id: true, name: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(user: AuthUser, id: number) {
    const o = await this.prisma.order.findFirst({
      where: { id, deletedAt: null, customer: customerScopeWhere(user) },
      include: {
        customer: { select: { id: true, name: true, customerNo: true } },
        product: true,
        payments: { where: { deletedAt: null }, orderBy: { id: 'desc' } },
        refunds: { where: { deletedAt: null }, orderBy: { id: 'desc' } },
        commission: true,
      },
    });
    if (!o) throw new NotFoundException('订单不存在或无权访问');
    return o;
  }

  private async loadScoped(user: AuthUser, id: number) {
    const o = await this.prisma.order.findFirst({
      where: { id, deletedAt: null, customer: customerScopeWhere(user) },
    });
    if (!o) throw new NotFoundException('订单不存在或无权访问');
    return o;
  }

  async update(user: AuthUser, id: number, dto: UpdateOrderDto) {
    const o = await this.loadScoped(user, id);
    const original = dto.originalPrice ?? Number(o.originalPrice);
    const discount = dto.discountAmount ?? Number(o.discountAmount);
    const receivable = original - discount;
    const unpaid = receivable - Number(o.paidAmount);
    await this.prisma.order.update({
      where: { id },
      data: {
        originalPrice: dto.originalPrice,
        discountAmount: dto.discountAmount,
        contractNo: dto.contractNo,
        remark: dto.remark,
        receivableAmount: receivable,
        unpaidAmount: unpaid,
      },
    });
    return this.get(user, id);
  }

  async startService(user: AuthUser, id: number) {
    const o = await this.loadScoped(user, id);
    if (
      (
        [
          OrderStatus.REFUNDED,
          OrderStatus.CANCELLED,
          OrderStatus.COMPLETED,
        ] as OrderStatus[]
      ).includes(o.status)
    ) {
      throw new BadRequestException('该订单已终止/完成，无法开始服务');
    }
    await this.prisma.order.update({
      where: { id },
      data: { status: OrderStatus.IN_SERVICE },
    });
    await this.customers.recomputeMainStatus(o.customerId);
    return this.get(user, id);
  }

  async completeService(user: AuthUser, id: number) {
    const o = await this.loadScoped(user, id);
    if (
      ([OrderStatus.REFUNDED, OrderStatus.CANCELLED] as OrderStatus[]).includes(
        o.status,
      )
    ) {
      throw new BadRequestException('该订单已终止，无法完成服务');
    }
    await this.prisma.order.update({
      where: { id },
      data: { status: OrderStatus.COMPLETED },
    });
    await this.customers.recomputeMainStatus(o.customerId);
    // 结算条件=服务完成后 → 触发该订单分成进入待审核
    await this.commissions.onServiceCompleted(o.id);
    return this.get(user, id);
  }

  /** 删除订单：级联软删除其收款/退款/分成；若存在已到账收款或已退款则拦截并提示先删款项 */
  async remove(user: AuthUser, id: number) {
    const order = await this.loadScoped(user, id);
    const [confirmedPays, executedRefunds] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          orderId: id,
          deletedAt: null,
          confirmStatus: PaymentConfirmStatus.CONFIRMED,
        },
        select: { paymentNo: true },
      }),
      this.prisma.refund.findMany({
        where: { orderId: id, deletedAt: null, status: RefundStatus.REFUNDED },
        select: { refundNo: true },
      }),
    ]);
    if (confirmedPays.length || executedRefunds.length) {
      throw new BadRequestException({
        message:
          '该订单存在「已到账收款」或「已退款」记录，请先到收款 / 退款页删除这些记录，再删除订单。',
        blockingPayments: confirmedPays.map((p) => p.paymentNo),
        blockingRefunds: executedRefunds.map((r) => r.refundNo),
      });
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.payment.updateMany({
        where: { orderId: id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.refund.updateMany({
        where: { orderId: id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.commission.updateMany({
        where: { orderId: id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.order.update({ where: { id }, data: { deletedAt: now } }),
    ]);
    await this.customers.recomputeMainStatus(order.customerId);
    return { ok: true };
  }
}
