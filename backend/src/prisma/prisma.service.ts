import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private keepAlive?: ReturnType<typeof setInterval>;

  async onModuleInit() {
    // 首次连接失败不要拖垮启动，否则 Railway 健康检查失败 → 崩溃重启循环；Prisma 会在后续查询惰性重连
    try {
      await this.$connect();
      this.logger.log('数据库连接成功');
    } catch (err) {
      this.logger.error('首次连接数据库失败，应用继续启动，后续查询将自动重试', err as Error);
    }
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
