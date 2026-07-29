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
  FollowUpDto,
  SetProblemDto,
  SetStatusDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
import * as ExcelJS from 'exceljs';

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
        customerNo: await nextNo(this.prisma.customer, 'customerNo', 'KH'),
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
    if (q.ownerUserId) where.ownerUserId = parseInt(q.ownerUserId, 10);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { id: 'desc' },
        ...(showAll ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
        include: {
          channel: { select: { id: true, name: true, channelType: true } },
          acquisitionChannel: { select: { id: true, name: true } },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);
    // 附上负责销售姓名（Customer 无 owner 关系，单独查 users 映射）
    const ownerIds = [
      ...new Set(items.map((i) => i.ownerUserId).filter((v): v is number => !!v)),
    ];
    const owners = ownerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, name: true },
        })
      : [];
    const ownerMap = new Map(owners.map((u) => [u.id, u.name]));
    const enriched = items.map((i) => ({
      ...i,
      ownerName: i.ownerUserId ? (ownerMap.get(i.ownerUserId) ?? null) : null,
    }));
    return { items: enriched, total, page, pageSize };
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
    await this.loadScoped(user, id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { ...dto };
    if (
      dto.name !== undefined &&
      !([UserRole.BUSINESS_SUPERVISOR, UserRole.ADMIN] as UserRole[]).includes(user.role)
    ) {
      delete data.name;
    } else if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('客户姓名不能为空');
      data.name = name;
    }
    if (dto.discoveredAt !== undefined) {
      data.discoveredAt = dto.discoveredAt ? new Date(dto.discoveredAt) : null;
    }
    // 改了第三方渠道 → 重算渠道名称/分成比例快照
    if (dto.channelId !== undefined) {
      if (dto.channelId) {
        const ch = await this.prisma.channel.findFirst({
          where: { id: dto.channelId, deletedAt: null },
        });
        data.channelNameSnapshot = ch?.name ?? null;
        data.commissionRateSnapshot = ch?.defaultCommissionRate
          ? Number(ch.defaultCommissionRate)
          : null;
      } else {
        data.channelNameSnapshot = null;
        data.commissionRateSnapshot = null;
      }
    }
    return this.prisma.customer.update({ where: { id }, data });
  }

  async assign(user: AuthUser, id: number, dto: AssignDto) {
    await this.loadScoped(user, id);
    const target = await this.prisma.user.findUnique({
      where: { id: dto.ownerUserId },
    });
    if (
      !target ||
      !([UserRole.SALES, UserRole.BUSINESS_SUPERVISOR] as UserRole[]).includes(
        target.role,
      )
    ) {
      throw new BadRequestException('负责销售必须是销售或营业主管角色用户');
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

  // ===== 二期：销售阶段 / 评分 / AI 摘要 =====

  async setSalesStage(user: AuthUser, id: number, salesStage: SalesStage) {
    await this.loadScoped(user, id);
    return this.prisma.customer.update({ where: { id }, data: { salesStage } });
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
        const dups = await this.findDuplicates(phone, wechat, email);
        if (dups.length) {
          duplicates++;
          continue;
        }
        await this.prisma.customer.create({
          data: {
            customerNo: await nextNo(this.prisma.customer, 'customerNo', 'KH'),
            name,
            phone,
            wechat,
            email,
            sourceCategory: SourceCategory.SELF,
            enteredById: user.id,
            discoveredAt: new Date(),
            mainStatus: CustomerMainStatus.NEW_LEAD,
            remark: pick(row, '备注'),
          },
        });
        success++;
      } catch (e) {
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
