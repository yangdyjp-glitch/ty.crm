import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private keepAlive?: ReturnType<typeof setInterval>;

  onModuleInit() {
    // 关键：不要 await——连接慢/卡住会阻塞 Nest 启动，导致 HTTP 迟迟不监听、Railway 健康检查超时失败。
    // 改为后台连接：连不上也不挡启动与健康检查；Prisma 会在首次查询时自动重连。
    void this.$connect()
      .then(() => this.logger.log('数据库连接成功'))
      .catch((err) =>
        this.logger.error('首次连接数据库失败，后续查询将自动重试', err as Error),
      );
    // 保活心跳：每 4 分钟 ping 一次，防止 Supabase 连接池空闲断连（P1001）
    this.keepAlive = setInterval(
      () => {
        this.$queryRaw`SELECT 1`.catch(() => {});
      },
      4 * 60 * 1000,
    );
  }

  async onModuleDestroy() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    await this.$disconnect();
  }
}
