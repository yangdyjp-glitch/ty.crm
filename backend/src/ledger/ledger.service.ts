import { Injectable } from '@nestjs/common';
import { Currency, LedgerEntryType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 第三方往来 / 抵扣台账（按渠道 + 币种）。
 * balanceAfter 约定：> 0 = 第三方净欠公司；< 0 = 公司净欠第三方。
 *   - 模式二公司垫付佣金（退款追回）→ amount 为正（第三方欠公司）
 *   - 模式一第三方垫付退款 → amount 为负（公司欠第三方）
 *   - 新单佣金抵扣已挂账 → amount 为负（冲减第三方欠公司）
 */
@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  async getBalance(channelId: number, currency: Currency): Promise<number> {
    const last = await this.prisma.channelLedger.findFirst({
      where: { channelId, currency },
      orderBy: { id: 'desc' },
    });
    return last ? Number(last.balanceAfter) : 0;
  }

  async addEntry(p: {
    channelId: number;
    currency: Currency;
    entryType: LedgerEntryType;
    amount: number;
    relatedOrderId?: number;
    relatedRefundId?: number;
    relatedCommissionId?: number;
    note?: string;
    operatorId?: number;
  }) {
    const prev = await this.getBalance(p.channelId, p.currency);
    const balanceAfter = Math.round((prev + p.amount) * 100) / 100;
    return this.prisma.channelLedger.create({
      data: {
        channelId: p.channelId,
        currency: p.currency,
        entryType: p.entryType,
        amount: p.amount,
        balanceAfter,
        relatedOrderId: p.relatedOrderId,
        relatedRefundId: p.relatedRefundId,
        relatedCommissionId: p.relatedCommissionId,
        note: p.note,
        operatorId: p.operatorId,
      },
    });
  }

  list(channelId: number) {
    return this.prisma.channelLedger.findMany({
      where: { channelId },
      orderBy: { id: 'desc' },
    });
  }

  /** 某渠道两币种的当前余额 */
  async balances(channelId: number) {
    const [cny, jpy] = await Promise.all([
      this.getBalance(channelId, Currency.CNY),
      this.getBalance(channelId, Currency.JPY),
    ]);
    return { CNY: cny, JPY: jpy };
  }
}
