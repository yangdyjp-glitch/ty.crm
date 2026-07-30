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
import { nextPairedNo } from '../common/util';
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
    const quantity = dto.quantity ?? 1;
    const unitPrice =
      dto.unitPrice ??
      (dto.originalPrice != null ? dto.originalPrice / quantity : Number(product.standardPrice));
    const original = unitPrice * quantity;
    const discount = dto.discountAmount ?? 0;
    const receivable = original - discount;
    // 首款+尾款 ≠ 应收 时必须填写差异说明（存入备注）
    const paySum = dto.firstPaymentAmount + (dto.tailPaymentAmount ?? 0);
    if (paySum !== receivable && !dto.remark) {
      throw new BadRequestException('首款+尾款与应收不一致，请填写差异说明');
    }

    const orderNo = await nextPairedNo(
      this.prisma.order,
      'orderNo',
      'DD',
      customer.customerNo,
    );
    const contractNo =
      dto.contractNo ||
      (await nextPairedNo(this.prisma.order, 'contractNo', 'HT', customer.customerNo));
    const firstPayNo = await nextPairedNo(
      this.prisma.payment,
      'paymentNo',
      'SK',
      customer.customerNo,
    );
    const hasTail = !!dto.tailPaymentAmount && dto.tailPaymentAmount > 0;
    // 尾款继续沿用客户编号尾号，加后缀避免与首款编号撞号。
    const tailPayNo = hasTail
      ? await nextPairedNo(
          this.prisma.payment,
          'paymentNo',
          'SK',
          customer.customerNo,
          [firstPayNo],
        )
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
          unitPrice,
          quantity,
          originalPrice: original,
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
    q: { customerId?: string; status?: OrderStatus; all?: string; page?: string; pageSize?: string },
  ) {
    const showAll = q.all === '1' || q.all === 'true';
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
        ...(showAll ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
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
    const currentQuantity = o.quantity ?? 1;
    const quantity = dto.quantity ?? currentQuantity;
    const baseUnitPrice =
      dto.unitPrice ??
      (o.unitPrice != null ? Number(o.unitPrice) : Number(o.originalPrice) / currentQuantity);
    const changedUnitOrQuantity = dto.unitPrice !== undefined || dto.quantity !== undefined;
    const original = changedUnitOrQuantity
      ? baseUnitPrice * quantity
      : dto.originalPrice ?? Number(o.originalPrice);
    const unitPrice =
      changedUnitOrQuantity || dto.originalPrice === undefined
        ? baseUnitPrice
        : original / quantity;
    const discount = dto.discountAmount ?? Number(o.discountAmount);
    const receivable = original - discount;
    const unpaid = receivable - Number(o.paidAmount);
    await this.prisma.order.update({
      where: { id },
      data: {
        unitPrice,
        quantity,
        originalPrice: original,
        discountAmount: dto.discountAmount,
        contractNo: dto.contractNo,
        signedAt: dto.signedAt ? new Date(dto.signedAt) : undefined,
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
    if (o.status !== OrderStatus.IN_SERVICE) {
      throw new BadRequestException('仅服务中的订单可完成服务');
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
