import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CommissionStatus,
  CustomerMainStatus,
  OrderStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  /** 创建通知（去重：同用户+类型+关联对象已有未读则跳过） */
  async create(p: {
    userId: number;
    type: string;
    title: string;
    content?: string;
    relatedType?: string;
    relatedId?: number;
  }) {
    const exists = await this.prisma.notification.findFirst({
      where: {
        userId: p.userId,
        type: p.type,
        relatedType: p.relatedType ?? null,
        relatedId: p.relatedId ?? null,
        isRead: false,
      },
    });
    if (exists) return exists;
    return this.prisma.notification.create({ data: p });
  }

  listForUser(userId: number, unreadOnly: boolean) {
    return this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { isRead: false } : {}) },
      orderBy: { id: 'desc' },
      take: 100,
    });
  }

  async unreadCount(userId: number) {
    return { count: await this.prisma.notification.count({ where: { userId, isRead: false } }) };
  }

  async markRead(userId: number, id: number) {
    await this.prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
    return { ok: true };
  }

  async markAllRead(userId: number) {
    await this.prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    return { ok: true };
  }

  /** 定时扫描：逾期未跟进 / 分成待审核 / 未缴尾款 → 生成通知 */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async scan() {
    const now = new Date();

    const overdue = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        ownerUserId: { not: null },
        nextFollowUpAt: { lt: now },
        mainStatus: { in: [CustomerMainStatus.NEW_LEAD, CustomerMainStatus.FOLLOWING] },
      },
      select: { id: true, name: true, ownerUserId: true },
    });
    for (const c of overdue) {
      await this.create({
        userId: c.ownerUserId!,
        type: 'OVERDUE_FOLLOWUP',
        title: `客户「${c.name}」已逾期未跟进`,
        relatedType: 'Customer',
        relatedId: c.id,
      });
    }

    const pendingReview = await this.prisma.commission.count({
      where: { deletedAt: null, status: CommissionStatus.PENDING_REVIEW },
    });
    if (pendingReview > 0) {
      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN, status: 'active' },
        select: { id: true },
      });
      for (const a of admins) {
        await this.create({
          userId: a.id,
          type: 'COMMISSION_REVIEW',
          title: `有 ${pendingReview} 笔渠道分成待审核`,
          relatedType: 'Commission',
        });
      }
    }

    const unpaid = await this.prisma.order.findMany({
      where: { deletedAt: null, status: OrderStatus.PARTIAL_PAID },
      select: { id: true, orderNo: true, customer: { select: { ownerUserId: true, name: true } } },
    });
    for (const o of unpaid) {
      if (o.customer?.ownerUserId) {
        await this.create({
          userId: o.customer.ownerUserId,
          type: 'UNPAID_BALANCE',
          title: `订单 ${o.orderNo}（${o.customer.name}）有未缴尾款`,
          relatedType: 'Order',
          relatedId: o.id,
        });
      }
    }

    return {
      scanned: { overdue: overdue.length, pendingReview, unpaid: unpaid.length },
    };
  }
}
