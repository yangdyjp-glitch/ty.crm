import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentStatus,
  CustomerMainStatus,
  IntentionLevel,
  OrderStatus,
  Prisma,
  SalesStage,
  SourceCategory,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { customerScopeWhere } from '../common/scope';
import { nextNo } from '../common/util';
import {
  AssignDto,
  CreateCustomerDto,
  CustomerIdentityDto,
  FollowUpDto,
  SetProblemDto,
  SetStatusDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
import * as ExcelJS from 'exceljs';
import { CustomerIdentity, normalizeCustomerName, sameCustomerCandidate } from '../common/customer-identity';

const memberInclude = {
  where: { removedAt: null },
  include: { user: { select: { id: true, name: true } } },
  orderBy: { userId: 'asc' as const },
};

export interface CustomerListQuery {
  search?: string;
  mainStatus?: CustomerMainStatus;
  channelId?: string;
  ownerUserId?: string;
  assignmentStatus?: AssignmentStatus;
  intentionLevel?: string;
  all?: string;
  page?: string;
  pageSize?: string;
}

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findDuplicates(user: AuthUser, input: CustomerIdentityDto, tx: Prisma.TransactionClient = this.prisma) {
    const normalizedName = normalizeCustomerName(input.name);
    if (!normalizedName) return [];
    const matches = await tx.customer.findMany({
      where: { deletedAt: null, normalizedName },
      orderBy: { id: 'asc' },
      select: {
        id: true, customerNo: true, name: true, sourceCategory: true, enteredById: true,
        channelId: true, acquisitionChannelId: true,
        channel: { select: { name: true } },
        acquisitionChannel: { select: { name: true } },
        salesMembers: memberInclude,
      },
    });
    return matches.filter((customer) => sameCustomerCandidate(input, customer)).map((customer) => ({
      id: customer.id,
      customerNo: customer.customerNo,
      name: customer.name,
      channelName: customer.channel?.name ?? customer.acquisitionChannel?.name ?? '未填写渠道',
      salesOwners: customer.salesMembers.map((member) => member.user),
      alreadyResponsible: customer.salesMembers.some((member) => member.userId === user.id),
      canOpen: user.role === UserRole.ADMIN
        || customer.enteredById === user.id && user.role !== UserRole.SALES
        || customer.salesMembers.some((member) => member.userId === user.id),
      matchReason: (input.sourceCategory === SourceCategory.SELF ? input.acquisitionChannelId : input.channelId)
        && (customer.sourceCategory === SourceCategory.SELF ? customer.acquisitionChannelId : customer.channelId)
        ? '同名同渠道' : '同名，渠道信息不完整',
    }));
  }

  private async lockWrites(tx: Prisma.TransactionClient) {
    // Covers duplicate detection and customer-number allocation in concurrent creates.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(20773, 1)::text`;
  }

  private async validateSales(tx: Prisma.TransactionClient, ids: number[]) {
    const unique = [...new Set(ids)].sort((a, b) => a - b);
    const count = await tx.user.count({ where: {
      id: { in: unique }, deletedAt: null, status: 'active',
      role: { in: [UserRole.SALES, UserRole.BUSINESS_SUPERVISOR] },
    } });
    if (count !== unique.length) throw new BadRequestException('负责销售必须是启用的销售或营业主管');
    return unique;
  }

  private async sourceData(tx: Prisma.TransactionClient, input: CustomerIdentity) {
    if (input.sourceCategory === SourceCategory.SELF) {
      if (input.acquisitionChannelId) {
        const channel = await tx.acquisitionChannel.findFirst({ where: { id: input.acquisitionChannelId, deletedAt: null } });
        if (!channel) throw new BadRequestException('获取渠道不存在');
      }
      return { sourceCategory: input.sourceCategory, acquisitionChannelId: input.acquisitionChannelId ?? null,
        channelId: null, channelNameSnapshot: null, commissionRateSnapshot: null };
    }
    if (!input.channelId) throw new BadRequestException('第三方来源必须选择渠道');
    const channel = await tx.channel.findFirst({ where: { id: input.channelId, deletedAt: null } });
    if (!channel) throw new BadRequestException('渠道不存在');
    const expectedType = input.sourceCategory === SourceCategory.INDIVIDUAL_THIRD_PARTY ? 'INDIVIDUAL' : 'ENTERPRISE';
    if (channel.channelType !== expectedType) throw new BadRequestException('来源类型与渠道不一致');
    return { sourceCategory: input.sourceCategory, acquisitionChannelId: null, channelId: channel.id,
      channelNameSnapshot: channel.name, commissionRateSnapshot: channel.defaultCommissionRate };
  }

  async create(user: AuthUser, dto: CreateCustomerDto) {
    const name = dto.name.normalize('NFKC').trim();
    if (!name) throw new BadRequestException('客户姓名不能为空');
    return this.prisma.$transaction(async (tx) => {
      await this.lockWrites(tx);
      const source = await this.sourceData(tx, dto);
      const dups = await this.findDuplicates(user, dto, tx);
      if (dups.length && !dto.distinctReason?.trim()) {
        throw new ConflictException({ code: 'DUPLICATE_CUSTOMER', message: '该客户可能已存在', duplicates: dups });
      }
      const requestedIds = dto.salesUserIds ?? (dto.ownerUserId ? [dto.ownerUserId] : []);
      const salesIds = await this.validateSales(tx,
        user.role === UserRole.SALES ? [user.id] : requestedIds.length ? requestedIds
          : user.role === UserRole.BUSINESS_SUPERVISOR ? [user.id] : []);
      const customer = await tx.customer.create({
      data: {
        customerNo: await nextNo(tx.customer, 'customerNo', 'KH'),
        name,
        normalizedName: normalizeCustomerName(name),
        nickname: dto.nickname,
        phone: dto.phone,
        wechat: dto.wechat,
        email: dto.email,
        countryRegion: dto.countryRegion,
        educationLevel: dto.educationLevel,
        targetStage: dto.targetStage,
        targetStartTime: dto.targetStartTime,
        ...source,
        enteredById: user.id,
        ownerUserId: salesIds[0] ?? null,
        assignmentStatus: salesIds.length
          ? AssignmentStatus.ASSIGNED
          : AssignmentStatus.UNASSIGNED,
        intentionLevel: dto.intentionLevel ?? null,
        remark: dto.remark,
        discoveredAt: dto.discoveredAt ? new Date(dto.discoveredAt) : new Date(),
        mainStatus: CustomerMainStatus.NEW_LEAD,
        salesMembers: { create: salesIds.map((userId) => ({ userId, addedById: user.id })) },
      },
      });
      await tx.auditLog.create({ data: {
        operatorId: user.id, relatedType: 'Customer', relatedId: customer.id,
        action: dups.length ? 'CREATE_DISTINCT_CUSTOMER' : 'CREATE_CUSTOMER',
        newValue: JSON.stringify({ name, salesUserIds: salesIds, matchedCustomerIds: dups.map((d) => d.id) }),
        reason: dups.length ? dto.distinctReason!.trim() : null,
      } });
      return customer;
    });
  }

  async joinSales(user: AuthUser, id: number, input: CustomerIdentityDto) {
    if (!([UserRole.SALES, UserRole.BUSINESS_SUPERVISOR] as UserRole[]).includes(user.role)) {
      throw new ForbiddenException('只有销售或营业主管可以加入共同销售');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockWrites(tx);
      await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${id} FOR UPDATE`;
      const customer = await tx.customer.findFirst({ where: { id, deletedAt: null }, include: { salesMembers: memberInclude } });
      if (!customer || !sameCustomerCandidate(input, customer)) {
        throw new ConflictException('客户姓名或渠道已变化，请重新查重');
      }
      await this.validateSales(tx, [user.id]);
      if (customer.salesMembers.some((member) => member.userId === user.id)) return { id, alreadyResponsible: true };
      await tx.customerSales.upsert({
        where: { customerId_userId: { customerId: id, userId: user.id } },
        create: { customerId: id, userId: user.id, addedById: user.id },
        update: { removedAt: null, joinedAt: new Date(), addedById: user.id },
      });
      await tx.customer.update({ where: { id }, data: {
        ownerUserId: customer.ownerUserId ?? user.id, assignmentStatus: AssignmentStatus.ASSIGNED,
        updatedAt: new Date(Math.max(Date.now(), customer.updatedAt.getTime() + 1)),
      } });
      await tx.auditLog.create({ data: {
        operatorId: user.id, relatedType: 'Customer', relatedId: id, action: 'JOIN_CUSTOMER_SALES',
        fieldName: 'salesOwners', oldValue: JSON.stringify(customer.salesMembers.map((member) => member.user.name)),
        newValue: JSON.stringify([...customer.salesMembers.map((member) => member.user.name), user.name]),
      } });
      const recipients = [...new Set([...customer.salesMembers.map((member) => member.userId), customer.enteredById])].filter((uid) => uid !== user.id);
      if (recipients.length) await tx.notification.createMany({ data: recipients.map((userId) => ({
        userId, type: 'SHARED_SALES_JOINED', title: `客户「${customer.name}」新增共同销售`,
        content: `${user.name} 已确认同一客户并加入共同销售`, relatedType: 'Customer', relatedId: id,
      })) });
      return { id, alreadyResponsible: false };
    });
  }

  async list(user: AuthUser, q: CustomerListQuery) {
    const showAll = q.all === '1' || q.all === 'true';
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
    if (q.ownerUserId) where.salesMembers = { some: { userId: parseInt(q.ownerUserId, 10), removedAt: null } };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { id: 'desc' },
        ...(showAll ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
        include: {
          channel: { select: { id: true, name: true, channelType: true } },
          acquisitionChannel: { select: { id: true, name: true } },
          salesMembers: memberInclude,
        },
      }),
      this.prisma.customer.count({ where }),
    ]);
    const enriched = items.map((i) => ({
      ...i,
      salesOwners: i.salesMembers.map((member) => member.user),
      ownerName: i.salesMembers.map((member) => member.user.name).join('、') || null,
    }));
    return { items: enriched, total, page, pageSize };
  }

  async get(user: AuthUser, id: number) {
    const c = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null, ...customerScopeWhere(user) },
      include: {
        channel: true,
        acquisitionChannel: true,
        salesMembers: memberInclude,
        followUps: { orderBy: { followedAt: 'desc' } },
        orders: { where: { deletedAt: null }, orderBy: { id: 'desc' }, include: { salesMembers: { include: { user: { select: { id: true, name: true } } } } } },
        referrals: { where: { deletedAt: null }, orderBy: { id: 'desc' } },
      },
    });
    if (!c) throw new NotFoundException('客户不存在或无权访问');
    const changes = await this.prisma.auditLog.findMany({
      where: { relatedType: 'Customer', relatedId: id }, orderBy: { id: 'desc' }, take: 200,
    });
    const userIds = [...new Set([...c.followUps.map((f) => f.followUserId), ...changes.map((log) => log.operatorId).filter((uid): uid is number => uid != null)])];
    const operators = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const names = new Map(operators.map((operator) => [operator.id, operator.name]));
    return { ...c,
      salesOwners: c.salesMembers.map((member) => member.user),
      followUps: c.followUps.map((follow) => ({ ...follow, operatorName: names.get(follow.followUserId) ?? '未知用户' })),
      changes: changes.map((change) => ({ ...change, operatorName: change.operatorId ? names.get(change.operatorId) ?? '未知用户' : '系统' })),
      orders: c.orders.map((order) => ({ ...order, salesOwners: order.salesMembers.map((member) => member.user) })),
    };
  }

  /** 在用户可写范围内取客户（找不到即无权/不存在） */
  private async loadScoped(user: AuthUser, id: number) {
    const c = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null, ...customerScopeWhere(user) },
    });
    if (!c) throw new NotFoundException('客户不存在或无权访问');
    return c;
  }

  /** 软删除客户 */
  async remove(user: AuthUser, id: number) {
    await this.loadScoped(user, id);
    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  async update(user: AuthUser, id: number, dto: UpdateCustomerDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockWrites(tx);
      const current = await this.loadForWrite(tx, user, id, dto.expectedUpdatedAt);
      const { expectedUpdatedAt: _version, discoveredAt, ...fields } = dto;
      const data: Prisma.CustomerUncheckedUpdateInput = { ...fields };
      if (dto.name !== undefined) {
        if (!([UserRole.BUSINESS_SUPERVISOR, UserRole.ADMIN] as UserRole[]).includes(user.role)) {
          throw new ForbiddenException('仅主管或管理员可以修改客户姓名');
        }
        const name = dto.name.normalize('NFKC').trim();
        if (!name) throw new BadRequestException('客户姓名不能为空');
        data.name = name;
        data.normalizedName = normalizeCustomerName(name);
      }
      if (discoveredAt !== undefined) data.discoveredAt = discoveredAt ? new Date(discoveredAt) : null;
      if (dto.sourceCategory !== undefined || dto.channelId !== undefined || dto.acquisitionChannelId !== undefined) {
        Object.assign(data, await this.sourceData(tx, {
          name: current.name,
          sourceCategory: dto.sourceCategory ?? current.sourceCategory,
          channelId: dto.channelId !== undefined ? dto.channelId : current.channelId,
          acquisitionChannelId: dto.acquisitionChannelId !== undefined ? dto.acquisitionChannelId : current.acquisitionChannelId,
        }));
      }
      return this.saveWithAudit(tx, user, current, data);
    });
  }

  private async loadForWrite(tx: Prisma.TransactionClient, user: AuthUser, id: number, version: string) {
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${id} FOR UPDATE`;
    const current = await tx.customer.findFirst({ where: { id, deletedAt: null, ...customerScopeWhere(user) } });
    if (!current) throw new NotFoundException('客户不存在或无权访问');
    if (!version || new Date(version).getTime() !== current.updatedAt.getTime()) {
      throw new ConflictException({ code: 'STALE_CUSTOMER', message: '客户资料已被其他人更新，请刷新后核对并重新提交' });
    }
    return current;
  }

  private async saveWithAudit(
    tx: Prisma.TransactionClient, user: AuthUser,
    current: { id: number; updatedAt: Date }, data: Prisma.CustomerUncheckedUpdateInput,
  ) {
    const updated = await tx.customer.update({ where: { id: current.id }, data: {
      ...data, updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
    } });
    const before = current as Record<string, unknown>;
    const after = updated as Record<string, unknown>;
    const changes = Object.keys(data).filter((field) => field !== 'normalizedName' && JSON.stringify(before[field]) !== JSON.stringify(after[field]));
    if (changes.length) await tx.auditLog.createMany({ data: changes.map((fieldName) => ({
      operatorId: user.id, relatedType: 'Customer', relatedId: current.id, action: 'UPDATE_CUSTOMER',
      fieldName, oldValue: JSON.stringify(before[fieldName] ?? null), newValue: JSON.stringify(after[fieldName] ?? null),
    })) });
    return updated;
  }

  async assign(user: AuthUser, id: number, dto: AssignDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockWrites(tx);
      const current = await this.loadForWrite(tx, user, id, dto.expectedUpdatedAt);
      const ids = await this.validateSales(tx, dto.salesUserIds);
      const existing = await tx.customerSales.findMany({ where: { customerId: id, removedAt: null }, include: { user: { select: { name: true } } } });
      await tx.customerSales.updateMany({ where: { customerId: id, removedAt: null, userId: { notIn: ids } }, data: { removedAt: new Date() } });
      for (const userId of ids) {
        if (existing.some((member) => member.userId === userId)) continue;
        await tx.customerSales.upsert({ where: { customerId_userId: { customerId: id, userId } },
          create: { customerId: id, userId, addedById: user.id }, update: { removedAt: null, joinedAt: new Date(), addedById: user.id } });
      }
      const updated = await tx.customer.update({ where: { id }, data: {
        ownerUserId: ids[0] ?? null, assignmentStatus: ids.length ? AssignmentStatus.ASSIGNED : AssignmentStatus.UNASSIGNED,
        updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
      } });
      const owners = await tx.user.findMany({ where: { id: { in: ids } }, select: { name: true } });
      await tx.auditLog.create({ data: {
        operatorId: user.id, relatedType: 'Customer', relatedId: id, action: 'ASSIGN_CUSTOMER_SALES', fieldName: 'salesOwners',
        oldValue: JSON.stringify(existing.map((member) => member.user.name)), newValue: JSON.stringify(owners.map((owner) => owner.name)),
      } });
      const recipients = [...new Set([...ids, ...existing.map((member) => member.userId)])].filter((uid) => uid !== user.id);
      if (recipients.length) await tx.notification.createMany({ data: recipients.map((userId) => ({
        userId, type: 'SHARED_SALES_CHANGED', title: `客户「${current.name}」负责销售已调整`,
        content: `当前销售：${owners.map((owner) => owner.name).join('、') || '未分配'}`, relatedType: 'Customer', relatedId: id,
      })) });
      return updated;
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
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const c = await this.loadForWrite(tx, user, id, dto.expectedUpdatedAt);
      await tx.followUpLog.create({
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
      });
      await this.saveWithAudit(tx, user, c, {
          latestFollowUpAt: now,
          nextFollowUpAt: dto.nextFollowUpAt
            ? new Date(dto.nextFollowUpAt)
            : undefined,
          mainStatus:
            c.mainStatus === CustomerMainStatus.NEW_LEAD
              ? CustomerMainStatus.FOLLOWING
              : undefined,
      });
      await tx.auditLog.create({ data: { operatorId: user.id, relatedType: 'Customer', relatedId: id, action: 'ADD_FOLLOW_UP', newValue: dto.content } });
    });
    return this.get(user, id);
  }

  async setProblem(user: AuthUser, id: number, dto: SetProblemDto) {
    return this.prisma.$transaction(async (tx) => {
      const c = await this.loadForWrite(tx, user, id, dto.expectedUpdatedAt);
      return this.saveWithAudit(tx, user, c, {
        hasProblem: dto.hasProblem,
        problemNote: dto.problemNote,
        problemHandlerId: dto.problemHandlerId,
      });
    });
  }

  async setStatus(user: AuthUser, id: number, dto: SetStatusDto) {
    return this.update(user, id, { expectedUpdatedAt: dto.expectedUpdatedAt, mainStatus: dto.mainStatus });
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

  // ===== 二期：销售阶段 / 评分 / AI 摘要 =====

  async setSalesStage(user: AuthUser, id: number, salesStage: SalesStage, version: string) {
    return this.prisma.$transaction(async (tx) => {
      const c = await this.loadForWrite(tx, user, id, version);
      return this.saveWithAudit(tx, user, c, { salesStage });
    });
  }

  /** AI 跟进摘要（框架级：汇总近 10 条跟进；接入大模型后增强） */
  async aiSummary(user: AuthUser, id: number) {
    await this.loadScoped(user, id);
    const c = await this.prisma.customer.findUnique({
      where: { id },
      include: { followUps: { orderBy: { followedAt: 'desc' }, take: 10 } },
    });
    if (!c || !c.followUps.length) return { summary: '暂无跟进记录。' };
    const lines = c.followUps.map((f) => `· ${f.content}`).join('\n');
    return {
      summary: `近 ${c.followUps.length} 次跟进要点（框架级，接入大模型后自动总结）：\n${lines}`,
    };
  }

  // ===== 导入 / 导出 =====

  async exportExcel(user: AuthUser): Promise<Buffer> {
    const customers = await this.prisma.customer.findMany({
      where: { deletedAt: null, ...customerScopeWhere(user) },
      orderBy: { id: 'desc' },
      include: {
        channel: { select: { name: true } },
        acquisitionChannel: { select: { name: true } },
        salesMembers: memberInclude,
      },
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('客户');
    ws.columns = [
      { header: '客户编号', key: 'customerNo', width: 16 },
      { header: '姓名', key: 'name', width: 14 },
      { header: '电话', key: 'phone', width: 16 },
      { header: '微信', key: 'wechat', width: 16 },
      { header: '邮箱', key: 'email', width: 20 },
      { header: '来源', key: 'source', width: 18 },
      { header: '渠道/获取渠道', key: 'chan', width: 18 },
      { header: '负责销售', key: 'salesOwners', width: 24 },
      { header: '状态', key: 'status', width: 14 },
      { header: '意向', key: 'intention', width: 8 },
      { header: '创建时间', key: 'createdAt', width: 12 },
    ];
    for (const c of customers) {
      ws.addRow({
        customerNo: c.customerNo,
        name: c.name,
        phone: c.phone ?? '',
        wechat: c.wechat ?? '',
        email: c.email ?? '',
        source: c.sourceCategory,
        chan: c.channel?.name ?? c.acquisitionChannel?.name ?? '',
        salesOwners: c.salesMembers.map((member) => member.user.name).join('、'),
        status: c.mainStatus,
        intention: c.intentionLevel ?? '',
        createdAt: c.createdAt.toISOString().slice(0, 10),
      });
    }
    return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  }

  async importExcel(user: AuthUser, buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) {
      return { success: 0, duplicates: 0, failed: 0, errors: ['无工作表'] };
    }
    const headers: Record<string, number> = {};
    ws.getRow(1).eachCell((c, col) => {
      headers[String(c.value).trim()] = col;
    });
    const pick = (row: ExcelJS.Row, ...names: string[]) => {
      for (const n of names) {
        if (headers[n]) return cellStr(row.getCell(headers[n]).value);
      }
      return undefined;
    };
    let success = 0;
    let duplicates = 0;
    let failed = 0;
    const errors: string[] = [];
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const name = pick(row, '姓名', '客户姓名');
      if (!name) continue;
      const phone = pick(row, '电话', '手机号');
      const wechat = pick(row, '微信', '微信号');
      const email = pick(row, '邮箱');
      try {
        await this.create(user, {
            name,
            phone,
            wechat,
            email,
            sourceCategory: SourceCategory.SELF,
            discoveredAt: new Date().toISOString(),
            remark: pick(row, '备注'),
        });
        success++;
      } catch (e) {
        if (e instanceof ConflictException) { duplicates++; continue; }
        failed++;
        errors.push(`行${i}: ${(e as Error).message}`);
      }
    }
    return { success, duplicates, failed, errors: errors.slice(0, 20) };
  }
}

function cellStr(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown };
    if (o.text != null) return String(o.text).trim() || undefined;
    if (o.result != null) return String(o.result).trim() || undefined;
    return undefined;
  }
  const s = String(v).trim();
  return s === '' ? undefined : s;
}
