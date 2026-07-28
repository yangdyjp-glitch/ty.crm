import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CommissionStatus,
  FundSettlementMode,
  PaymentConfirmStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';

const r2 = (n: number) => Math.round(n * 100) / 100;

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
    const orders = await this.prisma.order.groupBy({
      by: ['currency'],
      where: { deletedAt: null },
      _sum: {
        receivableAmount: true,
        paidAmount: true,
        unpaidAmount: true,
        refundAmount: true,
      },
    });
    const commissions = await this.prisma.commission.groupBy({
      by: ['currency'],
      where: { deletedAt: null, fundSettlementMode: FundSettlementMode.COMPANY_REBATE },
      _sum: { payableAmount: true, paidAmount: true, unpaidAmount: true },
    });
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
      byCurrency: { orders, commissions },
    };
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
      include: { commission: true },
    });

    const summary = new Map<string, any>();
    const byMode = new Map<string, any>();
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
      const contractAmount = Number(order.receivableAmount);
      const confirmedReceived = Number(order.paidAmount);
      const unpaidAmount = Number(order.unpaidAmount);
      const refundAmount = Number(order.refundAmount);
      const channelPayable = Number(commission?.payableAmount ?? 0);
      const hasArrived = confirmedReceived > 0;
      let channelSettled = 0;
      let pendingRebate = 0;
      let companyActualReceived = 0;
      let balance = 0;

      if (commission) {
        if (fundSettlementMode === FundSettlementMode.AGENT_NET) {
          channelSettled = channelPayable;
        } else if (commission.status === CommissionStatus.PAID) {
          channelSettled = Number(commission.paidAmount || commission.payableAmount);
        } else if (commission.status !== CommissionStatus.CANCELLED) {
          pendingRebate = Number(commission.unpaidAmount || commission.payableAmount);
        }
      }

      if (hasArrived) {
        if (!commission) {
          companyActualReceived = contractAmount;
          balance = contractAmount;
        } else if (fundSettlementMode === FundSettlementMode.AGENT_NET) {
          companyActualReceived = r2(contractAmount - channelPayable);
          balance = companyActualReceived;
        } else {
          companyActualReceived = contractAmount;
          balance =
            commission.status === CommissionStatus.PAID
              ? r2(contractAmount - channelPayable)
              : contractAmount;
        }
      }

      const rows = [
        summary.get(currency) ?? empty(currency),
        byMode.get(`${currency}:${fundSettlementMode}`) ??
          empty(currency, fundSettlementMode),
      ];
      for (const row of rows) {
        row.orderCount += 1;
        row.receivableAmount = r2(row.receivableAmount + contractAmount);
        row.confirmedReceived = r2(row.confirmedReceived + confirmedReceived);
        row.unpaidAmount = r2(row.unpaidAmount + unpaidAmount);
        row.refundAmount = r2(row.refundAmount + refundAmount);
        row.channelPayable = r2(row.channelPayable + channelPayable);
        row.channelSettled = r2(row.channelSettled + channelSettled);
        row.pendingRebate = r2(row.pendingRebate + pendingRebate);
        row.companyActualReceived = r2(
          row.companyActualReceived + companyActualReceived,
        );
        row.balance = r2(row.balance + balance);
      }
      summary.set(currency, rows[0]);
      byMode.set(`${currency}:${fundSettlementMode}`, rows[1]);
    }

    return {
      summary: [...summary.values()],
      byMode: [...byMode.values()],
    };
  }

  async channels() {
    const grouped = await this.prisma.commission.groupBy({
      by: ['channelId', 'currency'],
      where: { deletedAt: null },
      _sum: { payableAmount: true, paidAmount: true, unpaidAmount: true },
      _count: true,
    });
    const channels = await this.prisma.channel.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, channelType: true },
    });
    const nameMap = new Map(channels.map((c) => [c.id, c]));
    return grouped.map((g) => ({
      ...g,
      channel: nameMap.get(g.channelId) ?? null,
    }));
  }

  async funnel() {
    return this.prisma.customer.groupBy({
      by: ['salesStage'],
      where: { deletedAt: null, salesStage: { not: null } },
      _count: true,
    });
  }

  async sales() {
    const byOwner = await this.prisma.customer.groupBy({
      by: ['ownerUserId'],
      where: { deletedAt: null, ownerUserId: { not: null } },
      _count: true,
    });
    const users = await this.prisma.user.findMany({
      where: { role: { in: [UserRole.SALES, UserRole.BUSINESS_SUPERVISOR] } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(users.map((u) => [u.id, u.name]));
    return byOwner.map((o) => ({
      ownerUserId: o.ownerUserId,
      name: o.ownerUserId ? (nameMap.get(o.ownerUserId) ?? '—') : '—',
      customerCount: o._count,
    }));
  }
}
