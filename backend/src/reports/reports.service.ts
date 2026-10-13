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
  roundMoney,
} from '../common/finance';

type ChannelReportRow = {
  channelId: number;
  currency: string;
  channel: { id: number; name: string };
  _count: number;
  _sum: {
    receivableAmount: number;
    confirmedReceived: number;
    orderUnpaidAmount: number;
    payableAmount: number;
    paidAmount: number;
    unpaidAmount: number;
    companyNetReceived: number;
  };
};

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
        where: { deletedAt: null, salesMembers: { some: { userId: uid, removedAt: null } } },
      }),
      this.prisma.customer.count({
        where: {
          deletedAt: null,
          salesMembers: { some: { userId: uid, removedAt: null } },
          nextFollowUpAt: { lt: new Date() },
        },
      }),
      this.prisma.order.count({
        where: {
          deletedAt: null,
          salesMembers: { some: { userId: uid } },
          signedAt: { gte: ms },
        },
      }),
    ]);
    const orders = await this.prisma.order.groupBy({
      by: ['currency'],
      where: { deletedAt: null, salesMembers: { some: { userId: uid } } },
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
        salesMembers: { select: { userId: true } },
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
          .flatMap((order) => order.salesMembers.map((member) => member.userId)),
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
      sharedOrderCount: 0,
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
      const salesUserIdsForOrder: (number | null)[] = order.salesMembers.length
        ? order.salesMembers.map((member) => member.userId) : [null];
      const salesRows = salesUserIdsForOrder.map((salesUserId) => {
        const key = `${currency}:${salesUserId ?? 'unassigned'}`;
        const row = bySales.get(key) ?? {
          ...empty(currency), salesUserId,
          salesName: salesUserId ? (salesNameMap.get(salesUserId) ?? '未知销售') : '未分配',
        };
        bySales.set(key, row);
        return row;
      });
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
        byProduct.get(productKey) ?? {
          ...empty(currency),
          productId: order.product.id,
          productName: order.product.name,
        },
        ...salesRows,
      ];
      for (const row of rows) {
        row.orderCount += 1;
        if (order.salesMembers.length > 1) row.sharedOrderCount += 1;
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
      byProduct.set(productKey, rows[2]);
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
    // Start from orders so zero-commission and non-commission orders retain their revenue.
    const orders = await this.prisma.order.findMany({
      where: {
        deletedAt: null,
        ...this.signedAtRange(q),
        OR: [
          { commission: { isNot: null } },
          { customer: { channelId: { not: null } } },
        ],
      },
      include: {
        commission: {
          include: { channel: { select: { id: true, name: true } } },
        },
        customer: {
          select: {
            channelId: true,
            channel: { select: { id: true, name: true } },
          },
        },
        refunds: {
          where: { deletedAt: null, status: RefundStatus.REFUNDED },
          select: { status: true, bearer: true, cashAmount: true },
        },
      },
    });
    const grouped = new Map<string, ChannelReportRow>();
    for (const order of orders) {
      // Preserve the signed order's channel even if the customer's channel later changes.
      const channelId = order.commission?.channelId ?? order.customer.channelId;
      if (channelId == null) continue;
      const channel = order.commission?.channel ?? order.customer.channel ?? {
        id: channelId,
        name: order.commission?.channelNameSnapshot || `渠道 ${channelId}`,
      };
      const commission =
        order.commission && !order.commission.deletedAt ? order.commission : null;
      const contractAmount = Number(order.receivableAmount);
      const received = Number(order.paidAmount);
      const payable = Number(commission?.payableAmount ?? 0);
      const cash = orderCashPosition({
        confirmedReceived: received,
        receivableAmount: contractAmount,
        companyCashRefund: companyCashRefunds(order.refunds),
        fundSettlementMode: commission?.fundSettlementMode ?? order.fundSettlementMode,
        commission,
      });
      // Only currencies actually present in orders produce rows; never mix currencies.
      const key = `${channelId}:${order.currency}`;
      const row =
        grouped.get(key) ??
        {
          channelId,
          currency: order.currency,
          _sum: {
            receivableAmount: 0,
            confirmedReceived: 0,
            orderUnpaidAmount: 0,
            payableAmount: 0,
            paidAmount: 0,
            unpaidAmount: 0,
            companyNetReceived: 0,
          },
          _count: 0,
          channel,
        };
      row._count += 1;
      row._sum.receivableAmount = roundMoney(row._sum.receivableAmount + contractAmount);
      row._sum.confirmedReceived = roundMoney(row._sum.confirmedReceived + received);
      row._sum.orderUnpaidAmount = roundMoney(row._sum.orderUnpaidAmount + Number(order.unpaidAmount));
      row._sum.payableAmount = roundMoney(row._sum.payableAmount + payable);
      row._sum.paidAmount = roundMoney(row._sum.paidAmount + cash.channelSettled);
      row._sum.unpaidAmount = roundMoney(row._sum.unpaidAmount + Math.max(0, payable - cash.channelSettled));
      row._sum.companyNetReceived = roundMoney(row._sum.companyNetReceived + cash.balance);
      grouped.set(key, row);
    }
    return [...grouped.values()]
      .map((row) => ({
        ...row,
        // Effective percentage within this report period, not today's channel default.
        commissionRate: row._sum.receivableAmount > 0
          ? roundMoney((row._sum.payableAmount / row._sum.receivableAmount) * 100)
          : null,
      }))
      .sort(
        (a, b) =>
          // CNY precedes JPY; keep each currency's channels in name order.
          a.currency.localeCompare(b.currency) ||
          a.channel.name.localeCompare(b.channel.name, 'zh-CN') ||
          a.channelId - b.channelId,
      );
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
    const customers = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        ...this.createdAtRange(q),
      },
      select: { id: true, salesMembers: { where: { removedAt: null }, select: { userId: true } } },
    });
    const signedByOwner = await this.prisma.order.findMany({
      where: {
        deletedAt: null,
        customer: { deletedAt: null },
        ...this.signedAtRange(q),
      },
      select: { id: true, salesMembers: { select: { userId: true } } },
    });
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { deletedAt: null, status: 'active', role: { in: [UserRole.SALES, UserRole.BUSINESS_SUPERVISOR] } },
          { id: { in: [...new Set([...customers, ...signedByOwner].flatMap((record) => record.salesMembers.map((member) => member.userId)))] } },
        ],
      },
      select: { id: true, name: true },
    });
    const counts = new Map(users.map((u) => [u.id, {
      ownerUserId: u.id, name: u.name, customerCount: 0, signedCount: 0,
      sharedCustomerCount: 0, sharedSignedCount: 0,
    }]));
    for (const customer of customers) for (const member of customer.salesMembers) {
      const row = counts.get(member.userId);
      if (row) { row.customerCount++; if (customer.salesMembers.length > 1) row.sharedCustomerCount++; }
    }
    for (const order of signedByOwner) for (const member of order.salesMembers) {
      const row = counts.get(member.userId);
      if (row) { row.signedCount++; if (order.salesMembers.length > 1) row.sharedSignedCount++; }
    }
    const rows = [...counts.values()]
      .sort(
        (a, b) =>
          b.customerCount - a.customerCount ||
          b.signedCount - a.signedCount ||
          a.name.localeCompare(b.name),
      );
    rows.push({
      ownerUserId: 0, name: '公司合计（去重）', customerCount: customers.length,
      signedCount: signedByOwner.length,
      sharedCustomerCount: customers.filter((c) => c.salesMembers.length > 1).length,
      sharedSignedCount: signedByOwner.filter((o) => o.salesMembers.length > 1).length,
    });
    return rows;
  }
}
