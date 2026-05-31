import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentStatus,
  CustomerMainStatus,
  IntentionLevel,
  OrderStatus,
  Prisma,
  SourceCategory,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { customerScopeWhere } from '../common/scope';
import { genNo } from '../common/util';
import {
  AssignDto,
  CreateCustomerDto,
  FollowUpDto,
  SetProblemDto,
  SetStatusDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

export interface CustomerListQuery {
  search?: string;
  mainStatus?: CustomerMainStatus;
  channelId?: string;
  ownerUserId?: string;
  assignmentStatus?: AssignmentStatus;
  intentionLevel?: string;
  page?: string;
  pageSize?: string;
}

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  findDuplicates(phone?: string, wechat?: string, email?: string) {
    const or: Prisma.CustomerWhereInput[] = [];
    if (phone) or.push({ phone });
    if (wechat) or.push({ wechat });
    if (email) or.push({ email });
    if (!or.length) return Promise.resolve([]);
    return this.prisma.customer.findMany({
      where: { deletedAt: null, OR: or },
      select: {
        id: true,
        customerNo: true,
        name: true,
        phone: true,
        wechat: true,
        email: true,
        mainStatus: true,
        createdAt: true,
      },
    });
  }

  async create(user: AuthUser, dto: CreateCustomerDto) {
    const dups = await this.findDuplicates(dto.phone, dto.wechat, dto.email);
    if (dups.length && !dto.force) {
      throw new ConflictException({ message: '疑似重复客户', duplicates: dups });
    }

    let channelNameSnapshot: string | null = null;
    let commissionRateSnapshot: number | null = null;
    if (dto.sourceCategory === SourceCategory.SELF) {
      // 自获取：仅可填获取渠道，无分成
    } else {
      if (!dto.channelId) {
        throw new BadRequestException('第三方来源必须选择渠道');
      }
      const ch = await this.prisma.channel.findFirst({
        where: { id: dto.channelId, deletedAt: null },
      });
      if (!ch) throw new BadRequestException('渠道不存在');
      channelNameSnapshot = ch.name;
      commissionRateSnapshot = ch.defaultCommissionRate
        ? Number(ch.defaultCommissionRate)
        : null;
    }

    const ownerUserId = dto.ownerUserId ?? null;
    return this.prisma.customer.create({
      data: {
        customerNo: genNo('C'),
        name: dto.name,
        nickname: dto.nickname,
        phone: dto.phone,
        wechat: dto.wechat,
        email: dto.email,
        countryRegion: dto.countryRegion,
        educationLevel: dto.educationLevel,
        targetStage: dto.targetStage,
        targetStartTime: dto.targetStartTime,
        sourceCategory: dto.sourceCategory,
        acquisitionChannelId:
          dto.sourceCategory === SourceCategory.SELF
            ? (dto.acquisitionChannelId ?? null)
            : null,
        channelId:
          dto.sourceCategory === SourceCategory.SELF
            ? null
            : (dto.channelId ?? null),
        channelNameSnapshot,
        commissionRateSnapshot,
        enteredById: user.id,
        ownerUserId,
        assignmentStatus: ownerUserId
          ? AssignmentStatus.ASSIGNED
          : AssignmentStatus.UNASSIGNED,
        intentionLevel: dto.intentionLevel ?? null,
        remark: dto.remark,
        discoveredAt: dto.discoveredAt ? new Date(dto.discoveredAt) : new Date(),
        mainStatus: CustomerMainStatus.NEW_LEAD,
      },
    });
  }

  async list(user: AuthUser, q: CustomerListQuery) {
    const page = Math.max(1, parseInt(q.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize || '20', 10)));
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...customerScopeWhere(user),
    };
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { phone: { contains: q.search } },
        { wechat: { contains: q.search } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { customerNo: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    if (q.mainStatus) where.mainStatus = q.mainStatus;
    if (q.assignmentStatus) where.assignmentStatus = q.assignmentStatus;
    if (q.intentionLevel)
      where.intentionLevel = q.intentionLevel as IntentionLevel;
    if (q.channelId) where.channelId = parseInt(q.channelId, 10);
    if (q.ownerUserId) where.ownerUserId = parseInt(q.ownerUserId, 10);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          channel: { select: { id: true, name: true, channelType: true } },
          acquisitionChannel: { select: { id: true, name: true } },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(user: AuthUser, id: number) {
    const c = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null, ...customerScopeWhere(user) },
      include: {
        channel: true,
        acquisitionChannel: true,
        followUps: { orderBy: { followedAt: 'desc' } },
        orders: { where: { deletedAt: null }, orderBy: { id: 'desc' } },
        referrals: { where: { deletedAt: null }, orderBy: { id: 'desc' } },
      },
    });
    if (!c) throw new NotFoundException('客户不存在或无权访问');
    return c;
  }

  /** 在用户可写范围内取客户（找不到即无权/不存在） */
  private async loadScoped(user: AuthUser, id: number) {
    const c = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null, ...customerScopeWhere(user) },
    });
    if (!c) throw new NotFoundException('客户不存在或无权访问');
    return c;
  }

  async update(user: AuthUser, id: number, dto: UpdateCustomerDto) {
    await this.loadScoped(user, id);
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  async assign(user: AuthUser, id: number, dto: AssignDto) {
    await this.loadScoped(user, id);
    const target = await this.prisma.user.findUnique({
      where: { id: dto.ownerUserId },
    });
    if (!target || target.role !== UserRole.SALES) {
      throw new BadRequestException('负责销售必须是销售角色用户');
    }
    return this.prisma.customer.update({
      where: { id },
      data: {
        ownerUserId: dto.ownerUserId,
        assignmentStatus: AssignmentStatus.ASSIGNED,
      },
    });
  }

  async assignDownstream(id: number, downstreamSalesUserId: number) {
    const c = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!c) throw new NotFoundException('客户不存在');
    const target = await this.prisma.user.findUnique({
      where: { id: downstreamSalesUserId },
    });
    if (!target || target.role !== UserRole.DOWNSTREAM_SALES) {
      throw new BadRequestException('必须分配给下游销售角色用户');
    }
    return this.prisma.customer.update({
      where: { id },
      data: { downstreamSalesUserId },
    });
  }

  async addFollowUp(user: AuthUser, id: number, dto: FollowUpDto) {
    const c = await this.loadScoped(user, id);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.followUpLog.create({
        data: {
          customerId: id,
          followUserId: user.id,
          followedAt: dto.followedAt ? new Date(dto.followedAt) : now,
          method: dto.method,
          content: dto.content,
          customerFeedback: dto.customerFeedback,
          result: dto.result,
          nextFollowUpAt: dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null,
        },
      }),
      this.prisma.customer.update({
        where: { id },
        data: {
          latestFollowUpAt: now,
          nextFollowUpAt: dto.nextFollowUpAt
            ? new Date(dto.nextFollowUpAt)
            : undefined,
          mainStatus:
            c.mainStatus === CustomerMainStatus.NEW_LEAD
              ? CustomerMainStatus.FOLLOWING
              : undefined,
        },
      }),
    ]);
    return this.get(user, id);
  }

  async setProblem(user: AuthUser, id: number, dto: SetProblemDto) {
    await this.loadScoped(user, id);
    return this.prisma.customer.update({
      where: { id },
      data: {
        hasProblem: dto.hasProblem,
        problemNote: dto.problemNote,
        problemHandlerId: dto.problemHandlerId,
      },
    });
  }

  async setStatus(user: AuthUser, id: number, dto: SetStatusDto) {
    await this.loadScoped(user, id);
    return this.prisma.customer.update({
      where: { id },
      data: { mainStatus: dto.mainStatus },
    });
  }

  /**
   * 按订单聚合重算客户主状态：退款只停被退订单，其他订单照常。
   * 优先级：服务中 > 已签约(有活动订单) > 已完成服务 > 已退款。
   * 无订单则不动（保留线索/跟进中）。
   */
  async recomputeMainStatus(customerId: number) {
    const orders = await this.prisma.order.findMany({
      where: { customerId, deletedAt: null },
      select: { status: true },
    });
    if (!orders.length) return;
    const active = orders.filter((o) =>
      (
        [
          OrderStatus.PENDING_PAYMENT,
          OrderStatus.PARTIAL_PAID,
          OrderStatus.FULLY_PAID,
          OrderStatus.IN_SERVICE,
        ] as OrderStatus[]
      ).includes(o.status),
    );
    let main: CustomerMainStatus;
    if (active.some((o) => o.status === OrderStatus.IN_SERVICE)) {
      main = CustomerMainStatus.IN_SERVICE;
    } else if (active.length) {
      main = CustomerMainStatus.SIGNED;
    } else if (orders.some((o) => o.status === OrderStatus.COMPLETED)) {
      main = CustomerMainStatus.COMPLETED;
    } else if (orders.some((o) => o.status === OrderStatus.REFUNDED)) {
      main = CustomerMainStatus.REFUNDED;
    } else {
      return;
    }
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { mainStatus: main },
    });
  }
}
