const test = require('node:test');
const assert = require('node:assert/strict');
const { CustomersService } = require('../dist/customers/customers.service');
const { mergeUnsetSelfChannel } = require('../scripts/merge-unset-self-channel');

const user = { id: 2, role: 'SALES', name: '测试销售' };
function serviceFixture(matches = []) {
  const state = { created: [], audits: [] };
  const tx = {
    $queryRaw: async () => [],
    acquisitionChannel: { findFirst: async ({ where }) => where.name ? { id: 10 } : { id: where.id } },
    customer: {
      findMany: async () => matches,
      findFirst: async () => null,
      create: async ({ data }) => { const row = { id: 1, ...data }; state.created.push(row); return row; },
    },
    user: { count: async () => 1 },
    auditLog: { create: async ({ data }) => state.audits.push(data) },
  };
  const db = { ...tx, $transaction: (run) => run(tx) };
  return { tx, state, service: new CustomersService(db) };
}

test('new self-acquired customers default to personal while explicit alternatives are retained', async () => {
  for (const chosen of [undefined, null, 11]) {
    const h = serviceFixture();
    const customer = await h.service.create(user, { name: '测试客户', sourceCategory: 'SELF', acquisitionChannelId: chosen });
    assert.equal(customer.acquisitionChannelId, chosen ?? 10);
    assert.equal(customer.channelId, null);
    assert.equal(customer.commissionRateSnapshot, null);
    assert.deepEqual(customer.salesMembers.create, [{ userId: 2, addedById: 2 }]);
    assert.equal(h.state.audits.length, 1);
  }
});

test('duplicate checking and creation use the same resolved acquisition channel', async () => {
  const matches = [10, 11].map((id) => ({ id, name: '测试客户', customerNo: `KH${id}`, sourceCategory: 'SELF',
    acquisitionChannelId: id, acquisitionChannel: { name: String(id) }, salesMembers: [], enteredById: 8 }));
  const h = serviceFixture(matches);
  assert.deepEqual((await h.service.findDuplicates(user, { name: '测试客户', sourceCategory: 'SELF' })).map((c) => c.id), [10]);
  assert.deepEqual((await h.service.findDuplicates(user, { name: '测试客户', sourceCategory: 'SELF', acquisitionChannelId: 11 })).map((c) => c.id), [11]);
  await assert.rejects(h.service.create(user, { name: '测试客户', sourceCategory: 'SELF' }), (e) => e.getStatus() === 409);
  assert.equal(h.state.created.length, 0);
});

test('unavailable default produces a useful error without substituting a different channel', async () => {
  const h = serviceFixture();
  h.tx.acquisitionChannel.findFirst = async ({ where }) => where.name ? null : { id: where.id };
  await assert.rejects(h.service.create(user, { name: '测试客户', sourceCategory: 'SELF' }), /个人渠道/);
  assert.equal((await h.service.create(user, { name: '测试客户', sourceCategory: 'SELF', acquisitionChannelId: 11 })).acquisitionChannelId, 11);
});

function migrationFixture({ financialMode = 'COMPANY_DIRECT', auditFails = false } = {}) {
  let state = { customers: [
    { id: 1, customerNo: 'KH000001', name: '保留姓名', ownerUserId: 4, channelId: null, acquisitionChannelId: null, sourceCategory: 'SELF', deletedAt: null },
    { id: 2, channelId: null, acquisitionChannelId: 11, sourceCategory: 'SELF', deletedAt: null },
    { id: 3, channelId: 7, acquisitionChannelId: null, sourceCategory: 'ENTERPRISE_THIRD_PARTY', deletedAt: null },
    { id: 4, channelId: null, acquisitionChannelId: null, sourceCategory: 'SELF', deletedAt: 'deleted' },
  ], audits: [] };
  const matches = (row, where) => row.deletedAt === where.deletedAt && row.sourceCategory === where.sourceCategory
    && row.acquisitionChannelId === where.acquisitionChannelId && (!where.id || where.id.in.includes(row.id));
  const db = { $transaction: async (run) => {
    const draft = structuredClone(state);
    const result = await run({
      $queryRaw: async () => [], $executeRaw: async () => 0,
      acquisitionChannel: { findFirst: async () => ({ id: 10, name: '个人渠道' }) },
      customer: {
        findMany: async ({ where }) => draft.customers.filter((c) => matches(c, where)),
        updateMany: async ({ where, data }) => {
          assert.deepEqual(Object.keys(data), ['acquisitionChannelId']);
          const rows = draft.customers.filter((c) => matches(c, where));
          rows.forEach((c) => Object.assign(c, data));
          return { count: rows.length };
        },
      },
      order: { findMany: async ({ where }) => where.customerId.in.length ? [{ id: 1, fundSettlementMode: financialMode, paidAmount: 8000, commission: null }] : [] },
      auditLog: { createMany: async ({ data }) => {
        if (auditFails) throw new Error('Audit unavailable');
        draft.audits.push(...data); return { count: data.length };
      } },
    });
    state = draft;
    return result;
  } };
  return { db, state: () => state };
}

test('merge previews without writes, changes only unset active SELF customers, and is repeatable', async () => {
  const h = migrationFixture();
  assert.equal((await mergeUnsetSelfChannel(h.db)).customers, 1);
  assert.equal(h.state().customers[0].acquisitionChannelId, null);
  const result = await mergeUnsetSelfChannel(h.db, true);
  assert.equal(result.updated, 1);
  assert.equal(result.financialRecordsUnchanged, true);
  const rows = h.state().customers;
  assert.deepEqual(rows.map((c) => c.acquisitionChannelId), [10, 11, null, null]);
  assert.equal(rows[0].name, '保留姓名');
  assert.equal(rows[0].ownerUserId, 4);
  assert.equal(h.state().audits[0].oldValue, 'null');
  assert.equal(h.state().audits[0].newValue, '10');
  assert.equal((await mergeUnsetSelfChannel(h.db, true)).updated, 0);
  assert.equal(h.state().audits.length, 1);
});

test('merge leaves customers unchanged if financial history is unexpected or auditing fails', async () => {
  for (const options of [{ financialMode: 'AGENT_NET' }, { auditFails: true }]) {
    const h = migrationFixture(options);
    await assert.rejects(mergeUnsetSelfChannel(h.db, true));
    assert.equal(h.state().customers[0].acquisitionChannelId, null);
    assert.equal(h.state().audits.length, 0);
  }
});
