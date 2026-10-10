const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { CustomersService } = require('../dist/customers/customers.service');
const { OrdersService } = require('../dist/orders/orders.service');
const { PaymentsService } = require('../dist/payments/payments.service');
const { ReportsService } = require('../dist/reports/reports.service');
const { CommissionsService } = require('../dist/commissions/commissions.service');
const { LedgerService } = require('../dist/ledger/ledger.service');
const { AuditService } = require('../dist/audit/audit.service');
const { ChannelsService } = require('../dist/channels/channels.service');
const { ChannelsController } = require('../dist/channels/channels.controller');
const { backfillSharedSales } = require('../scripts/backfill-shared-sales');

const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname), 'Integration tests require loopback PostgreSQL');
  assert.equal(target.pathname, '/crm_shared_sales_test', 'Use the dedicated disposable test database');
}
const rejectsStatus = (status) => (error) => error.getStatus?.() === status;

test('shared sales end-to-end with real PostgreSQL', { skip: !url }, async (t) => {
  const db = new PrismaClient({ datasourceUrl: url });
  t.after(() => db.$disconnect());
  // The guarded database above is disposable and never uses DATABASE_URL from .env.
  await db.$executeRawUnsafe('TRUNCATE "User", "Customer", "Channel", "Product", "AcquisitionChannel", "AuditLog", "Notification", "Attachment", "ImpersonationLog" RESTART IDENTITY CASCADE');
  const passwordHash = await bcrypt.hash('local-shared-sales-test', 4);
  const users = {};
  for (const [key, role] of Object.entries({ admin: 'ADMIN', market: 'MARKET', a: 'SALES', b: 'SALES', c: 'SALES', supervisor: 'BUSINESS_SUPERVISOR' })) {
    users[key] = await db.user.create({ data: { username: `shared_${key}`, name: `测试-${key}`, role, passwordHash } });
  }
  const { admin, market, a, b, c, supervisor } = users;
  const channels = [];
  for (let i = 1; i <= 2; i++) channels.push(await db.channel.create({ data: {
    channelNo: `QD00000${i}`, name: i === 1 ? '行知测试渠道' : '一嘉一测试渠道', channelType: 'ENTERPRISE',
    defaultCommissionRate: 20, fundSettlementMode: 'AGENT_NET', settlementCondition: 'ON_SIGN',
  } }));
  const acquisition = await db.acquisitionChannel.create({ data: { name: '测试自获取' } });
  const product = await db.product.create({ data: { name: '测试项目', standardPrice: 10000, currency: 'CNY' } });
  const customers = new CustomersService(db);
  const commissions = new CommissionsService(db, new LedgerService(db), new AuditService(db));
  const orders = new OrdersService(db, customers, commissions);
  const payments = new PaymentsService(db, commissions);
  const reports = new ReportsService(db);
  const legacy = await db.customer.create({ data: {
    customerNo: 'KH000001', name: '历史客户', sourceCategory: 'SELF', enteredById: market.id, ownerUserId: a.id,
  } });
  const ownerless = await db.customer.create({ data: {
    customerNo: 'KH000002', name: '历史未分配', sourceCategory: 'SELF', enteredById: market.id,
  } });
  const oldOrders = [];
  for (const customer of [legacy, ownerless]) oldOrders.push(await db.order.create({ data: {
    orderNo: `DD00000${customer.id}`, customerId: customer.id, productId: product.id, currency: 'CNY',
    signedAt: new Date('2020-01-01'), fundSettlementMode: 'COMPANY_DIRECT',
    originalPrice: 100, receivableAmount: 100, paidAmount: 10, unpaidAmount: 90,
  } }));
  await t.test('backfill preserves original ownership, money and unassigned history; rerun is idempotent', async () => {
    const first = await backfillSharedSales(db);
    assert.deepEqual(first, { normalized: 2, memberships: 1, orderSnapshots: 2 });
    assert.equal(await db.orderSales.count(), 1);
    assert.equal((await db.order.findUnique({ where: { id: oldOrders[0].id } })).paidAmount.toNumber(), 10);
    assert.deepEqual(await backfillSharedSales(db), { normalized: 0, memberships: 0, orderSnapshots: 0 });
  });
  const identity = { name: '张三', sourceCategory: 'ENTERPRISE_THIRD_PARTY', channelId: channels[0].id };
  let shared;
  await t.test('ordinary sales creates for self, duplicate hints do not expose contacts, same names in other channels stay separate', async () => {
    shared = await customers.create(a, { ...identity, phone: 'private-test-phone', salesUserIds: [b.id] });
    const matches = await customers.findDuplicates(b, identity);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].canOpen, false);
    assert.equal(matches[0].alreadyResponsible, false);
    assert.deepEqual(matches[0].salesOwners.map((u) => u.id), [a.id]);
    assert.equal('phone' in matches[0], false);
    await assert.rejects(customers.create(b, { ...identity, force: true }), rejectsStatus(409));
    const other = await customers.create(b, { ...identity, channelId: channels[1].id });
    assert.notEqual(other.id, shared.id);
    assert.deepEqual((await customers.findDuplicates(b, identity)).map((match) => match.id), [shared.id]);
    const sameName = await customers.create(b, { ...identity, distinctReason: '同名同渠道，另一位同学' });
    assert.notEqual(sameName.id, shared.id);
    assert.equal((await customers.findDuplicates(b, identity)).length, 2);
    assert.equal(await db.auditLog.count({ where: { action: 'CREATE_DISTINCT_CUSTOMER', reason: '同名同渠道，另一位同学' } }), 1);
  });
  await t.test('concurrent duplicate creates yield one customer and one conflict', async () => {
    const result = await Promise.allSettled([a, b].map((user) => customers.create(user, { ...identity, name: '并发录入测试' })));
    assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(result.find((r) => r.status === 'rejected').reason.getStatus(), 409);
    assert.equal(await db.customer.count({ where: { name: '并发录入测试' } }), 1);
  });
  await t.test('self-acquired identity, missing-channel warning and supervisor default membership', async () => {
    const own = await customers.create(supervisor, { name: '自主测试', sourceCategory: 'SELF', acquisitionChannelId: acquisition.id });
    assert.equal((await customers.get(supervisor, own.id)).salesOwners[0].id, supervisor.id);
    const hint = await customers.findDuplicates(b, { name: '自主测试', sourceCategory: 'SELF' });
    assert.equal(hint[0].matchReason, '同名，渠道信息不完整');
  });
  await t.test('joining is scoped to the chosen identity, idempotent, audited and notifies existing owners', async () => {
    await assert.rejects(customers.joinSales(c, shared.id, { ...identity, channelId: channels[1].id }), rejectsStatus(409));
    await assert.rejects(customers.joinSales(admin, shared.id, identity), rejectsStatus(403));
    const results = await Promise.all([customers.joinSales(b, shared.id, identity), customers.joinSales(b, shared.id, identity)]);
    assert.equal(results.filter((result) => result.alreadyResponsible).length, 1);
    const updated = await customers.get(b, shared.id);
    assert.equal(updated.customerNo, shared.customerNo);
    assert.equal(updated.phone, 'private-test-phone');
    assert.equal(updated.enteredById, a.id);
    assert.deepEqual(updated.salesOwners.map((u) => u.id), [a.id, b.id]);
    assert.equal(await db.auditLog.count({ where: { relatedId: shared.id, action: 'JOIN_CUSTOMER_SALES' } }), 1);
    assert.equal(await db.notification.count({ where: { userId: a.id, relatedId: shared.id, type: 'SHARED_SALES_JOINED' } }), 1);
  });
  await t.test('both sales can access the customer; an unrelated seller cannot access it even through search', async () => {
    for (const user of [a, b]) assert.ok((await customers.list(user, { all: '1', search: '张三' })).items.some((row) => row.id === shared.id));
    assert.equal((await customers.list(c, { all: '1', search: '张三' })).items.length, 0);
    await assert.rejects(customers.get(c, shared.id), rejectsStatus(404));
  });
  await t.test('stale writes are rejected and edits and followups retain their actual operator', async () => {
    const before = await customers.get(a, shared.id);
    await customers.update(a, shared.id, { expectedUpdatedAt: before.updatedAt.toISOString(), intentionLevel: 'A' });
    await assert.rejects(customers.update(b, shared.id, { expectedUpdatedAt: before.updatedAt.toISOString(), intentionLevel: 'B' }), rejectsStatus(409));
    let current = await customers.get(b, shared.id);
    await customers.addFollowUp(b, shared.id, { expectedUpdatedAt: current.updatedAt.toISOString(), method: 'WECHAT', content: '乙的跟进记录' });
    current = await customers.get(a, shared.id);
    assert.equal(current.intentionLevel, 'A');
    assert.equal(current.followUps[0].operatorName, b.name);
    assert.ok(current.changes.some((change) => change.operatorId === a.id && change.fieldName === 'intentionLevel' && change.newValue === '"A"'));
    await assert.rejects(customers.update(a, shared.id, { expectedUpdatedAt: current.updatedAt.toISOString(), name: '不允许销售改名' }), rejectsStatus(403));
  });
  let sharedOrders;
  await t.test('simultaneous joint-sales orders get distinct numbers and freeze both sales at signing', async () => {
    sharedOrders = await Promise.all([
      orders.create(a, { customerId: shared.id, productId: product.id, currency: 'CNY', unitPrice: 10000, firstPaymentAmount: 2000, tailPaymentAmount: 8000, signedAt: '2098-04-12' }),
      orders.create(b, { customerId: shared.id, productId: product.id, currency: 'JPY', unitPrice: 100000, firstPaymentAmount: 100000, signedAt: '2098-04-13' }),
    ]);
    assert.notEqual(sharedOrders[0].orderNo, sharedOrders[1].orderNo);
    const paymentNos = sharedOrders.flatMap((order) => order.payments.map((payment) => payment.paymentNo));
    assert.equal(new Set(paymentNos).size, 3);
    for (const order of sharedOrders) assert.deepEqual(order.salesOwners.map((owner) => owner.id).sort(), [a.id, b.id]);
    for (const order of sharedOrders) {
      const payment = order.payments.find((p) => p.remark === '首款');
      await payments.confirm(admin, payment.id);
    }
  });
  await t.test('concurrent extra collections keep unique numbers and pending amounts stay out of cash', async () => {
    const created = await Promise.all([a, b].map((user) => payments.create(user, { orderId: sharedOrders[0].id, amount: 10 })));
    assert.notEqual(created[0].paymentNo, created[1].paymentNo);
    assert.ok(created.every((payment) => payment.confirmStatus === 'PENDING'));
  });
  await t.test('CNY and JPY company totals count once while both sales get full shared performance', async () => {
    const finance = await reports.finance({ period: 'month', month: '2098-04' });
    const cny = finance.summary.find((row) => row.currency === 'CNY');
    const jpy = finance.summary.find((row) => row.currency === 'JPY');
    assert.equal(cny.orderCount, 1);
    assert.equal(cny.confirmedReceived, 2000);
    assert.equal(cny.companyActualReceived, 1600);
    assert.equal(cny.balance, 1600);
    assert.equal(jpy.orderCount, 1);
    assert.equal(jpy.companyActualReceived, 80000);
    assert.equal(jpy.balance, 80000);
    for (const user of [a, b]) for (const summary of finance.summary) {
      const row = finance.bySales.find((r) => r.salesUserId === user.id && r.currency === summary.currency);
      assert.equal(row.orderCount, 1);
      assert.equal(row.sharedOrderCount, 1);
      assert.equal(row.companyActualReceived, summary.companyActualReceived);
    }
    assert.equal(finance.byProduct.reduce((sum, row) => sum + row.orderCount, 0), 2);
    const stats = await reports.sales({ period: 'month', month: '2098-04' });
    assert.equal(stats.find((row) => row.ownerUserId === 0).signedCount, 2);
    for (const user of [a, b]) assert.equal(stats.find((row) => row.ownerUserId === user.id).sharedSignedCount, 2);
    const annual = await reports.finance({ period: 'year', year: '2098' });
    assert.deepEqual(annual.summary, finance.summary);
  });
  await t.test('later membership changes never reattribute historical orders or unassigned history', async () => {
    for (const customer of [shared, legacy, ownerless]) {
      const before = await customers.get(admin, customer.id);
      await customers.assign(admin, customer.id, { expectedUpdatedAt: before.updatedAt.toISOString(), salesUserIds: [b.id, c.id] });
    }
    await backfillSharedSales(db);
    assert.equal(await db.orderSales.count({ where: { orderId: oldOrders[1].id } }), 0);
    assert.deepEqual((await db.orderSales.findMany({ where: { orderId: oldOrders[0].id } })).map((member) => member.userId), [a.id]);
    for (const order of sharedOrders) assert.deepEqual((await orders.get(admin, order.id)).salesOwners.map((owner) => owner.id).sort(), [a.id, b.id]);
    await assert.rejects(customers.get(a, shared.id), rejectsStatus(404));
    assert.equal((await customers.get(c, shared.id)).id, shared.id);
    const before = await customers.get(admin, shared.id);
    await assert.rejects(customers.assign(admin, shared.id, { expectedUpdatedAt: before.updatedAt.toISOString(), salesUserIds: [admin.id] }), rejectsStatus(400));
  });
  await t.test('sales channel options contain no commission configuration', async () => {
    const controller = new ChannelsController(new ChannelsService(db, commissions));
    const options = await controller.options(a);
    assert.ok(options.length);
    assert.deepEqual(Object.keys(options[0]).sort(), ['channelType', 'id', 'name']);
  });
  await t.test('disabling a sales account does not erase past attribution', async () => {
    await db.user.update({ where: { id: a.id }, data: { status: 'disabled' } });
    try {
      const rows = await reports.sales({ period: 'year', year: '2098' });
      assert.equal(rows.find((row) => row.ownerUserId === a.id).signedCount, 2);
      await assert.rejects(customers.joinSales(a, shared.id, identity), rejectsStatus(400));
    } finally { await db.user.update({ where: { id: a.id }, data: { status: 'active' } }); }
  });
});
