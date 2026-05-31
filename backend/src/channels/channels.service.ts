import { Injectable, NotFoundException } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { genNo } from '../common/util';
import {
  CreateChannelDto,
  UpdateChannelDto,
} from './dto/channel.dto';

@Injectable()
export class ChannelsService {
  constructor(private prisma: PrismaService) {}

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

  create(dto: CreateChannelDto) {
    return this.prisma.channel.create({
      data: { channelNo: genNo('CH'), ...dto },
    });
  }

  update(id: number, dto: UpdateChannelDto) {
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
      where: { active: true },
      orderBy: { id: 'asc' },
    });
  }

  createAcquisition(name: string) {
    return this.prisma.acquisitionChannel.upsert({
      where: { name },
      update: { active: true },
      create: { name },
    });
  }
}
