import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CommissionStatus,
  FundSettlementMode,
  PaymentConfirmStatus,
  Prisma,
  RefundStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import {
  companyCashRefunds,
  orderCashPosition,
  pendingAgentDeduction,
  realizedAgentNetCommission,
  roundMoney,
} from '../common/finance';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private monthStart() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  }
  private dayStart() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  async dashboard(user: AuthUser) {
    switch (user.role) {
      case UserRole.ADMIN:
        return this.adminDashboard();
      case UserRole.SALES:
        return this.salesDashboard(user.id);
      case UserRole.BUSINESS_SUPERVISOR:
        return this.businessSupervisorDashboard(user.id);
      case UserRole.DOWNSTREAM_SALES:
        return this.downstreamDashboard(user.id);
      default:
        return this.marketDashboard(user.id);
    }
  }

  private async adminDashboard() {
    const ms = this.monthStart();
    const ds = this.dayStart();
    const [
      custTotal,
      newToday,
      newMonth,
      signedMonth,
      problem,
      pendingReview,
      pendingPay,
    ] = await Promise.all([
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.prisma.customer.count({
        where: { deletedAt: null, createdAt: { gte: ds } },
      }),
      this.prisma.customer.count({
        where: { deletedAt: null, createdAt: { gte: ms } },
      }),
      this.prisma.order.count({
        where: { deletedAt: null, signedAt: { gte: ms } },
      }),
      this.prisma.customer.count({
        where: { deletedAt: null, hasProblem: true },
      }),
      this.prisma.commission.count({
        where: { deletedAt: null, status: CommissionStatus.PENDING_REVIEW },
      }),
      this.prisma.payment.count({
        where: { deletedAt: null, confirmStatus: PaymentConfirmStatus.PENDING },
      }),
    ]);
    const [channelLeads, productLeads, salesLeads] = await Promise.all([
      this.channelLeadStats(),
      this.productLeadStats(),
      this.sales(),
    ]);
    const trend = await this.leadTrendStats();
    return {
      role: 'ADMIN',
      counts: {
        custTotal,
        newToday,
        newMonth,
        signedMonth,
        problem,
        pendingReview,
        pendingPay,
      },
      leadStats: {
        channels: channelLeads,
        products: productLeads,
        sales: salesLeads,
      },
      trend,
    };
  }

  private dateKey(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private async leadTrendStats(days = 30) {
    const today = this.dayStart();
    const start = new Date(today);
    start.setDate(today.getDate() - days + 1);

    const points = Array.from({ length: days }, (_, index) => {
      const d = new Date(start);
      d.setDate(start.getDate() + index);
      return {
        date: this.dateKey(d),
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        leads: 0,
        signed: 0,
      };
    });
    const byDate = new Map(points.map((p) => [p.date, p]));

    const [customers, orders] = await Promise.all([
      this.prisma.customer.findMany({
        where: {
          deletedAt: null,
          OR: [
            { discoveredAt: { gte: start } },
            { discoveredAt: null, createdAt: { gte: start } },
          ],
        },
        select: { discoveredAt: true, createdAt: true },
      }),
      this.prisma.order.findMany({
        where: { deletedAt: null, signedAt: { gte: start } },
        select: { signedAt: true },
      }),
    ]);

    customers.forEach((c) => {
      const row = byDate.get(this.dateKey(c.discoveredAt ?? c.createdAt));
      if (row) row.leads += 1;
    });
    orders.forEach((o) => {
      const row = byDate.get(this.dateKey(o.signedAt));
      if (row) row.signed += 1;
    });

    return points;
  }

  private async channelLeadStats() {
    const [customers, signedOrders, channels, acquisitionChannels] = await Promise.all([
      this.prisma.customer.findMany({
        where: { deletedAt: null },
        select: {
          sourceCategory: true,
          channelId: true,
          acquisitionChannelId: true,
        },
      }),
      this.prisma.order.findMany({
        where: { deletedAt: null, customer: { deletedAt: null } },
        select: {
          customer: {
            select: {
              sourceCategory: true,
              channelId: true,
              acquisitionChannelId: true,
            },
          },
        },
      }),
      this.prisma.channel.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, channelType: true },
      }),
      this.prisma.acquisitionChannel.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);

    const rows = new Map<
      string,
      { key: string; name: string; type: string; customerCount: number; signedCount: number }
    >();
    acquisitionChannels.forEach((c) =>
      rows.set(`acq:${c.id}`, {
        key: `acq:${c.id}`,
        name: c.name,
        type: '自获取',
        customerCount: 0,
        signedCount: 0,
      }),
    );
    channels.forEach((c) =>
      rows.set(`channel:${c.id}`, {
        key: `channel:${c.id}`,
        name: c.name,
        type: c.channelType === 'INDIVIDUAL' ? '个人第三方' : '企业第三方',
        customerCount: 0,
        signedCount: 0,
      }),
    );

    const fallback = (type: string) => {
      const key = `missing:${type}`;
      if (!rows.has(key)) {
        rows.set(key, { key, name: '未设置渠道', type, customerCount: 0, signedCount: 0 });
      }
      return rows.get(key)!;
    };

    const rowForSource = (c: {
      sourceCategory: string;
      channelId: number | null;
      acquisitionChannelId: number | null;
    }) => {
      if (c.sourceCategory === 'SELF') {
        return (
          (c.acquisitionChannelId ? rows.get(`acq:${c.acquisitionChannelId}`) : null) ??
          fallback('自获取')
        );
      }
      const type =
        c.sourceCategory === 'INDIVIDUAL_THIRD_PARTY'
          ? '个人第三方'
          : '企业第三方';
      return (c.channelId ? rows.get(`channel:${c.channelId}`) : null) ?? fallback(type);
    };

    for (const c of customers) {
      rowForSource(c)!.customerCount += 1;
    }
    for (const o of signedOrders) {
      rowForSource(o.customer)!.signedCount += 1;
    }

    return [...rows.values()].sort(
      (a, b) =>
        b.customerCount - a.customerCount ||
        b.signedCount - a.signedCount ||
        a.type.localeCompare(b.type),
    );
  }

  private async productLeadStats() {
    const [products, orders] = await Promise.all([
      this.prisma.product.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, category: true },
      }),
      this.prisma.order.findMany({
        where: { deletedAt: null },
        select: { productId: true, customerId: true },
      }),
    ]);

    const productCustomers = new Map<number, Set<number>>();
    const productSigned = new Map<number, number>();
    orders.forEach((o) => {
      if (!productCustomers.has(o.productId)) {
        productCustomers.set(o.productId, new Set());
      }
      productCustomers.get(o.productId)!.add(o.customerId);
      productSigned.set(o.productId, (productSigned.get(o.productId) ?? 0) + 1);
    });

    return products
      .map((p) => ({
        productId: p.id,
        name: p.name,
        category: p.category,
        customerCount: productCustomers.get(p.id)?.size ?? 0,
        signedCount: productSigned.get(p.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.customerCount - a.customerCount ||
          b.signedCount - a.signedCount ||
          a.name.localeCompare(b.name),
      );
  }

  private async salesDashboard(uid: number) {
    const ms = this.monthStart();
    const [myCustomers, overdue, signedMonth] = await Promise.all([
      this.prisma.customer.count({
        where: { deletedAt: null, ownerUserId: uid },
      }),
      this.prisma.customer.count({
        where: {
          deletedAt: null,
          ownerUserId: uid,
          nextFollowUpAt: { lt: new Date() },
        },
      }),
      this.prisma.order.count({
        where: {
          deletedAt: null,
          customer: { ownerUserId: uid },
          signedAt: { gte: ms },
        },
      }),
    ]);
    const orders = await this.prisma.order.groupBy({
      by: ['currency'],
      where: { deletedAt: null, customer: { ownerUserId: uid } },
      _sum: { receivableAmount: true, paidAmount: true },
    });
    return {
      role: 'SALES',
      counts: { myCustomers, overdue, signedMonth },
      byCurrency: { orders },
    };
  }

  private async downstreamDashboard(uid: number) {
    const referrals = await this.prisma.downstreamReferral.groupBy({
      by: ['currency', 'collectionStatus'],
      where: { deletedAt: null, downstreamSalesUserId: uid },
      _sum: { commissionAmount: true },
      _count: true,
    });
    return { role: 'DOWNSTREAM_SALES', referrals };
  }

  private async businessSupervisorDashboard(uid: number) {
    const [sales, market] = await Promise.all([
      this.salesDashboard(uid),
      this.marketDashboard(uid),
    ]);
    return {
      role: 'BUSINESS_SUPERVISOR',
      counts: {
        ...sales.counts,
        registeredTotal: market.counts.total,
        registeredMonth: market.counts.newMonth,
      },
      byCurrency: sales.byCurrency,
      byStatus: market.byStatus,
    };
  }

  private async marketDashboard(uid: number) {
    const ms = this.monthStart();
    const [total, newMonth] = await Promise.all([
      this.prisma.customer.count({ where: { deletedAt: null, enteredById: uid } }),
      this.prisma.customer.count({
        where: { deletedAt: null, enteredById: uid, createdAt: { gte: ms } },
      }),
    ]);
    const byStatus = await this.prisma.customer.groupBy({
      by: ['mainStatus'],
      where: { deletedAt: null, enteredById: uid },
      _count: true,
    });
    return { role: 'MARKET', counts: { total, newMonth }, byStatus };
  }

  // ===== 管理员报表（分币种） =====

  private signedAtRange(q: {
    period?: 'all' | 'year' | 'month';
    year?: string;
    month?: string;
  }) {
    const period = q.period || 'all';
    if (period === 'all') return {};

    if (period === 'year') {
      const year = parseInt(q.year || '', 10);
      if (!year || year < 2000 || year > 2100) {
        throw new BadRequestException('请选择有效年份');
      }
      return {
        signedAt: {
          gte: new Date(year, 0, 1),
          lt: new Date(year + 1, 0, 1),
        },
      };
    }

    if (period === 'month') {
      const match = /^(\d{4})-(\d{2})$/.exec(q.month || '');
      const year = match ? parseInt(match[1], 10) : 0;
      const month = match ? parseInt(match[2], 10) : 0;
      if (!year || month < 1 || month > 12) {
        throw new BadRequestException('请选择有效月份');
      }
      return {
        signedAt: {
          gte: new Date(year, month - 1, 1),
          lt: new Date(year, month, 1),
        },
      };
    }

    throw new BadRequestException('统计范围无效');
  }

  private createdAtRange(q: {
    period?: 'all' | 'year' | 'month';
    year?: string;
    month?: string;
  }): Prisma.CustomerWhereInput {
    const signedAt = this.signedAtRange(q).signedAt;
    return signedAt ? { createdAt: signedAt } : {};
  }

  async finance(q: {
    period?: 'all' | 'year' | 'month';
    year?: string;
    month?: string;
  }) {
    const where: Prisma.OrderWhereInput = {
      deletedAt: null,
      ...this.signedAtRange(q),
    };
    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { id: 'desc' },
      include: {
        commission: true,
        customer: { select: { ownerUserId: true } },
        product: { select: { id: true, name: true } },
        refunds: {
          where: { deletedAt: null, status: RefundStatus.REFUNDED },
          select: { status: true, bearer: true, cashAmount: true },
        },
      },
    });
    const salesUserIds = Array.from(
      new Set(
        orders
          .map((order) => order.customer.ownerUserId)
          .filter((id): id is number => id != null),
      ),
    );
    const salesUsers = salesUserIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: salesUserIds } },
          select: { id: true, name: true },
        })
      : [];
    const salesNameMap = new Map(salesUsers.map((user) => [user.id, user.name]));

    const summary = new Map<string, any>();
    const byMode = new Map<string, any>();
    const bySales = new Map<string, any>();
    const byProduct = new Map<string, any>();
    const empty = (currency: string, fundSettlementMode?: FundSettlementMode) => ({
      currency,
      fundSettlementMode,
      orderCount: 0,
      receivableAmount: 0,
      confirmedReceived: 0,
      unpaidAmount: 0,
      refundAmount: 0,
      channelPayable: 0,
      channelSettled: 0,
      pendingAgentDeduction: 0,
      pendingRebate: 0,
      companyActualReceived: 0,
      balance: 0,
    });

    for (const order of orders) {
      const commission =
        order.commission && !order.commission.deletedAt ? order.commission : null;
      const currency = order.currency;
      const fundSettlementMode =
        commission?.fundSettlementMode ?? order.fundSettlementMode;
      const salesUserId = order.customer.ownerUserId;
      const salesKey = `${currency}:${salesUserId ?? 'unassigned'}`;
      const productKey = `${currency}:${order.product.id}`;
      const contractAmount = Number(order.receivableAmount);
      const confirmedReceived = Number(order.paidAmount);
      const unpaidAmount = Number(order.unpaidAmount);
      const refundAmount = Number(order.refundAmount);
      const cashRefund = companyCashRefunds(order.refunds);
      const channelPayable = Number(commission?.payableAmount ?? 0);
      let pendingRebate = 0;
      const cash = orderCashPosition({
        confirmedReceived,
        receivableAmount: contractAmount,
        companyCashRefund: cashRefund,
        fundSettlementMode,
        commission,
      });
      const unrealizedAgentDeduction = commission
        ? pendingAgentDeduction({
            fundSettlementMode,
            channelPayable,
            channelSettled: cash.channelSettled,
            cancelled: commission.status === CommissionStatus.CANCELLED,
          })
        : 0;

      if (commission) {
        if (
          fundSettlementMode === FundSettlementMode.COMPANY_REBATE &&
          commission.status !== CommissionStatus.PAID &&
          commission.status !== CommissionStatus.CANCELLED
        ) {
          pendingRebate = roundMoney(
            Math.max(0, channelPayable - Number(commission.paidAmount || 0)),
          );
        }
      }

      const rows = [
        summary.get(currency) ?? empty(currency),
        byMode.get(`${currency}:${fundSettlementMode}`) ??
          empty(currency, fundSettlementMode),
        bySales.get(salesKey) ?? {
          ...empty(currency),
          salesUserId,
          salesName: salesUserId
            ? (salesNameMap.get(salesUserId) ?? '未知销售')
            : '未分配',
        },
        byProduct.get(productKey) ?? {
          ...empty(currency),
          productId: order.product.id,
          productName: order.product.name,
        },
      ];
      for (const row of rows) {
        row.orderCount += 1;
        row.receivableAmount = roundMoney(row.receivableAmount + contractAmount);
        row.confirmedReceived = roundMoney(row.confirmedReceived + confirmedReceived);
        row.unpaidAmount = roundMoney(row.unpaidAmount + unpaidAmount);
        row.refundAmount = roundMoney(row.refundAmount + refundAmount);
        row.channelPayable = roundMoney(row.channelPayable + channelPayable);
        row.channelSettled = roundMoney(
          row.channelSettled + cash.channelSettled,
        );
        row.pendingAgentDeduction = roundMoney(
          row.pendingAgentDeduction + unrealizedAgentDeduction,
        );
        row.pendingRebate = roundMoney(row.pendingRebate + pendingRebate);
        row.companyActualReceived = roundMoney(
          row.companyActualReceived + cash.actualReceived,
        );
        row.balance = roundMoney(row.balance + cash.balance);
      }
      summary.set(currency, rows[0]);
      byMode.set(`${currency}:${fundSettlementMode}`, rows[1]);
      bySales.set(salesKey, rows[2]);
      byProduct.set(productKey, rows[3]);
    }

    return {
      summary: [...summary.values()],
      byMode: [...byMode.values()],
      bySales: [...bySales.values()].sort(
        (a, b) =>
          a.currency.localeCompare(b.currency) ||
          a.salesName.localeCompare(b.salesName, 'zh-CN'),
      ),
      byProduct: [...byProduct.values()].sort(
        (a, b) =>
          a.currency.localeCompare(b.currency) ||
          a.productName.localeCompare(b.productName, 'zh-CN'),
      ),
    };
  }

  async channels(
    q: {
      period?: 'all' | 'year' | 'month';
      year?: string;
      month?: string;
    } = {},
  ) {
    const commissions = await this.prisma.commission.findMany({
      where: { deletedAt: null, order: this.signedAtRange(q) },
      include: {
        order: { select: { paidAmount: true, receivableAmount: true } },
      },
    });
    const channels = await this.prisma.channel.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, channelType: true },
    });
    const nameMap = new Map(channels.map((c) => [c.id, c]));
    const grouped = new Map<string, any>();
    for (const commission of commissions) {
      const key = `${commission.channelId}:${commission.currency}`;
      const row =
        grouped.get(key) ??
        {
          channelId: commission.channelId,
          currency: commission.currency,
          _sum: { payableAmount: 0, paidAmount: 0, unpaidAmount: 0 },
          _count: 0,
          channel: nameMap.get(commission.channelId) ?? null,
        };
      const payable = Number(commission.payableAmount);
      const paid =
        commission.fundSettlementMode === FundSettlementMode.AGENT_NET
          ? realizedAgentNetCommission(commission, commission.order)
          : Number(commission.paidAmount || 0);
      row._count += 1;
      row._sum.payableAmount = roundMoney(row._sum.payableAmount + payable);
      row._sum.paidAmount = roundMoney(row._sum.paidAmount + paid);
      row._sum.unpaidAmount = roundMoney(row._sum.unpaidAmount + Math.max(0, payable - paid));
      grouped.set(key, row);
    }
    return [...grouped.values()];
  }

  async funnel() {
    return this.prisma.customer.groupBy({
      by: ['salesStage'],
      where: { deletedAt: null, salesStage: { not: null } },
      _count: true,
    });
  }

  async sales(
    q: {
      period?: 'all' | 'year' | 'month';
      year?: string;
      month?: string;
    } = {},
  ) {
    const byOwner = await this.prisma.customer.groupBy({
      by: ['ownerUserId'],
      where: {
        deletedAt: null,
        ownerUserId: { not: null },
        ...this.createdAtRange(q),
      },
      _count: true,
    });
    const signedByOwner = await this.prisma.order.findMany({
      where: {
        deletedAt: null,
        customer: { deletedAt: null, ownerUserId: { not: null } },
        ...this.signedAtRange(q),
      },
      select: { customer: { select: { ownerUserId: true } } },
    });
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'active',
        role: { in: [UserRole.SALES, UserRole.BUSINESS_SUPERVISOR] },
      },
      select: { id: true, name: true },
    });
    const countMap = new Map(byOwner.map((o) => [o.ownerUserId, o._count]));
    const signedMap = new Map<number, number>();
    signedByOwner.forEach((o) => {
      const ownerUserId = o.customer.ownerUserId;
      if (ownerUserId) signedMap.set(ownerUserId, (signedMap.get(ownerUserId) ?? 0) + 1);
    });
    return users
      .map((u) => ({
        ownerUserId: u.id,
        name: u.name,
        customerCount: countMap.get(u.id) ?? 0,
        signedCount: signedMap.get(u.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.customerCount - a.customerCount ||
          b.signedCount - a.signedCount ||
          a.name.localeCompare(b.name),
      );
  }
}
