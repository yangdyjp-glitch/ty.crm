import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReferralCollectionStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import {
  CollectDto,
  CreateReferralDto,
  UpdateReferralDto,
} from './dto/referral.dto';

@Injectable()
export class ReferralsService {
  constructor(private prisma: PrismaService) {}

  private scope(user: AuthUser): Prisma.DownstreamReferralWhereInput {
    return user.role === UserRole.DOWNSTREAM_SALES
      ? { downstreamSalesUserId: user.id }
      : {};
  }

  async create(user: AuthUser, dto: CreateReferralDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('客户不存在');

    let downstreamSalesUserId: number;
    if (user.role === UserRole.ADMIN) {
      downstreamSalesUserId =
        dto.downstreamSalesUserId ??
        customer.downstreamSalesUserId ??
        user.id;
    } else {
      // 下游销售只能为分配给自己的客户登记
      if (customer.downstreamSalesUserId !== user.id) {
        throw new ForbiddenException('该客户未分配给你');
      }
      downstreamSalesUserId = user.id;
    }

    return this.prisma.downstreamReferral.create({
      data: {
        customerId: dto.customerId,
        serviceType: dto.serviceType,
        downstreamCompany: dto.downstreamCompany,
        commissionAmount: dto.commissionAmount,
        currency: dto.currency,
        settlementDate: dto.settlementDate ? new Date(dto.settlementDate) : null,
        downstreamSalesUserId,
        createdById: user.id,
        remark: dto.remark,
      },
    });
  }

  list(
    user: AuthUser,
    q: { collectionStatus?: ReferralCollectionStatus; customerId?: string },
  ) {
    const where: Prisma.DownstreamReferralWhereInput = {
      deletedAt: null,
      ...this.scope(user),
    };
    if (q.collectionStatus) where.collectionStatus = q.collectionStatus;
    if (q.customerId) where.customerId = parseInt(q.customerId, 10);
    return this.prisma.downstreamReferral.findMany({
      where,
      orderBy: { id: 'desc' },
      include: { customer: { select: { id: true, name: true, customerNo: true } } },
    });
  }

  private async loadScoped(user: AuthUser, id: number) {
    const r = await this.prisma.downstreamReferral.findFirst({
      where: { id, deletedAt: null, ...this.scope(user) },
    });
    if (!r) throw new NotFoundException('记录不存在或无权访问');
    return r;
  }

  async update(user: AuthUser, id: number, dto: UpdateReferralDto) {
    await this.loadScoped(user, id);
    return this.prisma.downstreamReferral.update({
      where: { id },
      data: {
        ...dto,
        settlementDate: dto.settlementDate
          ? new Date(dto.settlementDate)
          : undefined,
      },
    });
  }

  async collect(user: AuthUser, id: number, dto: CollectDto) {
    await this.loadScoped(user, id);
    return this.prisma.downstreamReferral.update({
      where: { id },
      data: {
        collectionStatus: ReferralCollectionStatus.COLLECTED,
        collectedAt: dto.collectedAt ? new Date(dto.collectedAt) : new Date(),
      },
    });
  }

  async uncollect(user: AuthUser, id: number) {
    await this.loadScoped(user, id);
    return this.prisma.downstreamReferral.update({
      where: { id },
      data: {
        collectionStatus: ReferralCollectionStatus.PENDING,
        collectedAt: null,
      },
    });
  }

  async remove(user: AuthUser, id: number) {
    await this.loadScoped(user, id);
    return this.prisma.downstreamReferral.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
