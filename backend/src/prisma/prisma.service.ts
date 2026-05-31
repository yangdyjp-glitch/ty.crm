import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private keepAlive?: ReturnType<typeof setInterval>;

  async onModuleInit() {
    await this.$connect();
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
