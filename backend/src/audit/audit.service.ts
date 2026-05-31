import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /** 记录操作日志（尽力而为，失败不影响主流程） */
  async log(p: {
    operatorId?: number;
    relatedType: string;
    relatedId?: number;
    action: string;
    fieldName?: string;
    oldValue?: string;
    newValue?: string;
    reason?: string;
  }) {
    try {
      return await this.prisma.auditLog.create({ data: p });
    } catch {
      return null;
    }
  }

  list(q: { relatedType?: string; operatorId?: string }) {
    const where: Prisma.AuditLogWhereInput = {};
    if (q.relatedType) where.relatedType = q.relatedType;
    if (q.operatorId) where.operatorId = parseInt(q.operatorId, 10);
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 200,
    });
  }
}
