import { Injectable } from '@nestjs/common';
import {
  CommissionStatus,
  FundSettlementMode,
  PaymentConfirmStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';

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

  async finance() {
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
      by: ['currency', 'fundSettlementMode'],
      where: { deletedAt: null },
      _sum: { payableAmount: true, paidAmount: true, unpaidAmount: true },
    });
    const referrals = await this.prisma.downstreamReferral.groupBy({
      by: ['currency', 'collectionStatus'],
      where: { deletedAt: null },
      _sum: { commissionAmount: true },
    });
    return { orders, commissions, referrals };
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
      where: { role: UserRole.SALES },
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
