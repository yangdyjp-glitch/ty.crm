import {
  PrismaClient,
  UserRole,
  ChannelType,
  FundSettlementMode,
  CommissionMethod,
  SettlementCondition,
  Currency,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10);

  // 四个测试账号（每角色一个），统一密码 admin123
  const users: { username: string; name: string; role: UserRole }[] = [
    { username: 'admin', name: '管理员', role: UserRole.ADMIN },
    { username: 'market', name: '市场-小王', role: UserRole.MARKET },
    { username: 'sales', name: '销售-小李', role: UserRole.SALES },
    { username: 'downstream', name: '下游销售-小张', role: UserRole.DOWNSTREAM_SALES },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: { name: u.name, role: u.role },
      create: { ...u, passwordHash },
    });
  }

  // 获取渠道字典（自获取用）
  for (const name of ['小红书', '微信公众号', '抖音', '朋友推荐', '官网']) {
    await prisma.acquisitionChannel.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // 样例项目（仅首次为空时创建）
  if ((await prisma.product.count()) === 0) {
    await prisma.product.createMany({
      data: [
        { name: '大学院申请服务', category: '留学申请', standardPrice: 500000, currency: Currency.JPY },
        { name: '语言学校申请', category: '留学申请', standardPrice: 200000, currency: Currency.JPY },
        { name: '本科申请服务', category: '留学申请', standardPrice: 30000, currency: Currency.CNY },
        { name: '就业内推服务', category: '就业', standardPrice: 300000, currency: Currency.JPY },
      ],
    });
  }

  // 样例第三方渠道（仅首次为空时创建）
  if ((await prisma.channel.count()) === 0) {
    await prisma.channel.create({
      data: {
        channelNo: 'CH0001',
        name: '王老师（个人）',
        channelType: ChannelType.INDIVIDUAL,
        contactName: '王老师',
        defaultCommissionRate: 10,
        commissionMethod: CommissionMethod.NET_RECEIVED_RATIO,
        fundSettlementMode: FundSettlementMode.COMPANY_REBATE,
        settlementCondition: SettlementCondition.ON_SERVICE_COMPLETE,
      },
    });
    await prisma.channel.create({
      data: {
        channelNo: 'CH0002',
        name: 'XX教育（企业）',
        channelType: ChannelType.ENTERPRISE,
        contactName: '李经理',
        defaultCommissionRate: 15,
        commissionMethod: CommissionMethod.NET_RECEIVED_RATIO,
        fundSettlementMode: FundSettlementMode.AGENT_NET,
        settlementCondition: SettlementCondition.ON_FULL_PAYMENT,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log('Seed done. 账号(密码均为 admin123): admin / market / sales / downstream');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
