import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ChannelType,
  CommissionMethod,
  FundSettlementMode,
  SettlementCondition,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { nextNo } from '../common/util';
import {
  CreateChannelDto,
  UpdateChannelDto,
} from './dto/channel.dto';

@Injectable()
export class ChannelsService {
  constructor(private prisma: PrismaService) {}

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

  async update(id: number, dto: UpdateChannelDto) {
    const current = await this.get(id);
    this.validateSettlementConfig({
      commissionMethod: dto.commissionMethod ?? current.commissionMethod,
      fundSettlementMode: dto.fundSettlementMode ?? current.fundSettlementMode,
      settlementCondition:
        dto.settlementCondition ?? current.settlementCondition,
    });
    return this.prisma.channel.update({ where: { id }, data: dto });
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
