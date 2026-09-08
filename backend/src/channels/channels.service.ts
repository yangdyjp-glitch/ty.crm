import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ChannelType,
  CommissionMethod,
  FundSettlementMode,
  Prisma,
  SettlementCondition,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CommissionPricingSyncResult,
  CommissionsService,
} from '../commissions/commissions.service';
import { nextNo } from '../common/util';
import {
  CreateChannelDto,
  UpdateChannelDto,
} from './dto/channel.dto';

@Injectable()
export class ChannelsService {
  constructor(
    private prisma: PrismaService,
    private commissions: CommissionsService,
  ) {}

  private async serializableTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 15000,
        });
      } catch (error) {
        if ((error as { code?: string })?.code === 'P2034' && attempt < 2) {
          continue;
        }
        throw error;
      }
    }
    throw new BadRequestException('渠道设置正在更新，请稍后重试');
  }

  private validateSettlementConfig(config: {
    commissionMethod?: CommissionMethod;
    fundSettlementMode?: FundSettlementMode;
    settlementCondition?: SettlementCondition;
  }) {
    if (config.fundSettlementMode === FundSettlementMode.COMPANY_DIRECT) {
      throw new BadRequestException('第三方渠道不能使用公司直收模式');
    }
    if (
      config.settlementCondition === SettlementCondition.ON_EACH_PAYMENT &&
      (config.fundSettlementMode ?? FundSettlementMode.COMPANY_REBATE) !==
        FundSettlementMode.COMPANY_REBATE
    ) {
      throw new BadRequestException('每笔到账后结算仅适用于公司代收·返佣');
    }
    if (
      config.settlementCondition === SettlementCondition.ON_EACH_PAYMENT &&
      (config.commissionMethod ?? CommissionMethod.NET_RECEIVED_RATIO) !==
        CommissionMethod.NET_RECEIVED_RATIO
    ) {
      throw new BadRequestException('每笔到账后结算仅支持按实收比例返佣');
    }
  }

  list(channelType?: ChannelType) {
    return this.prisma.channel.findMany({
      where: { deletedAt: null, ...(channelType ? { channelType } : {}) },
      orderBy: { id: 'desc' },
    });
  }

  options() {
    return this.prisma.channel.findMany({
      where: { deletedAt: null, cooperationStatus: { not: 'TERMINATED' } },
      select: {
        id: true,
        channelNo: true,
        name: true,
        channelType: true,
        defaultCommissionRate: true,
        defaultCommissionAmount: true,
        commissionMethod: true,
        fundSettlementMode: true,
        settlementCondition: true,
      },
      orderBy: { id: 'desc' },
    });
  }

  async get(id: number) {
    const c = await this.prisma.channel.findFirst({
      where: { id, deletedAt: null },
    });
    if (!c) throw new NotFoundException('渠道不存在');
    return c;
  }

  async create(dto: CreateChannelDto) {
    this.validateSettlementConfig(dto);
    return this.prisma.channel.create({
      data: { channelNo: await nextNo(this.prisma.channel, 'channelNo', 'QD'), ...dto },
    });
  }

  async update(id: number, dto: UpdateChannelDto, operatorId?: number) {
    return this.serializableTransaction(async (tx) => {
      const current = await tx.channel.findFirst({
        where: { id, deletedAt: null },
      });
      if (!current) throw new NotFoundException('渠道不存在');
      const nextConfig = {
        commissionMethod: dto.commissionMethod ?? current.commissionMethod,
        fundSettlementMode:
          dto.fundSettlementMode ?? current.fundSettlementMode,
        settlementCondition:
          dto.settlementCondition ?? current.settlementCondition,
      };
      this.validateSettlementConfig(nextConfig);
      const normalizePricing = (value: unknown) =>
        value == null ? null : Number(value);
      const relevantPricingChanged =
        nextConfig.commissionMethod === CommissionMethod.FIXED_AMOUNT
          ? normalizePricing(
              dto.defaultCommissionAmount ?? current.defaultCommissionAmount,
            ) !== normalizePricing(current.defaultCommissionAmount)
          : normalizePricing(
              dto.defaultCommissionRate ?? current.defaultCommissionRate,
            ) !== normalizePricing(current.defaultCommissionRate);
      const pricingChanged =
        nextConfig.commissionMethod !== current.commissionMethod ||
        relevantPricingChanged;
      const channel = await tx.channel.update({ where: { id }, data: dto });
      const commissionSync = pricingChanged
        ? await this.commissions.repriceOpenForChannel(tx, channel, operatorId)
        : null;
      return { ...channel, commissionSync };
    });
  }

  async syncCommissionPricing(operatorId?: number) {
    return this.serializableTransaction(async (tx) => {
      const channels = await tx.channel.findMany({
        where: { deletedAt: null },
        orderBy: { id: 'asc' },
      });
      const total: CommissionPricingSyncResult = {
        updated: 0,
        protected: 0,
        unchanged: 0,
        total: 0,
      };
      for (const channel of channels) {
        const result = await this.commissions.repriceOpenForChannel(
          tx,
          channel,
          operatorId,
        );
        total.updated += result.updated;
        total.protected += result.protected;
        total.unchanged += result.unchanged;
        total.total += result.total;
      }
      return total;
    });
  }

  remove(id: number) {
    return this.prisma.channel.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ===== 获取渠道字典（自获取用） =====
  listAcquisition() {
    return this.prisma.acquisitionChannel.findMany({
      where: { active: true, deletedAt: null },
      orderBy: { id: 'asc' },
    });
  }

  listAcquisitionAll() {
    return this.prisma.acquisitionChannel.findMany({
      where: { deletedAt: null },
      orderBy: { id: 'asc' },
    });
  }

  createAcquisition(name: string) {
    return this.prisma.acquisitionChannel.upsert({
      where: { name },
      update: { active: true, deletedAt: null },
      create: { name },
    });
  }

  updateAcquisition(id: number, dto: { name?: string; active?: boolean }) {
    return this.prisma.acquisitionChannel.update({
      where: { id },
      data: { name: dto.name, active: dto.active },
    });
  }

  removeAcquisition(id: number) {
    return this.prisma.acquisitionChannel.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
