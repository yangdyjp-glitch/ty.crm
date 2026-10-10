const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCustomerName, sameCustomerCandidate } = require('../dist/common/customer-identity');
const { customerScopeWhere } = require('../dist/common/scope');

test('customer identity uses normalized names and exact source-channel IDs', () => {
  assert.equal(normalizeCustomerName('  ALICE　  Smith '), 'alice smith');
  const base = { name: '张三', sourceCategory: 'ENTERPRISE_THIRD_PARTY', channelId: 1 };
  assert.equal(sameCustomerCandidate(base, { ...base, name: ' 张三 ' }), true);
  assert.equal(sameCustomerCandidate(base, { ...base, channelId: 2 }), false);
  assert.equal(sameCustomerCandidate(base, { ...base, name: '张四' }), false);
  assert.equal(sameCustomerCandidate(base, { ...base, channelId: null }), true);
  assert.equal(sameCustomerCandidate(base, { ...base, sourceCategory: 'SELF', acquisitionChannelId: 1 }), false);
  const own = { name: '张三', sourceCategory: 'SELF', acquisitionChannelId: 1 };
  assert.equal(sameCustomerCandidate(own, { ...own, acquisitionChannelId: 2 }), false);
  assert.equal(sameCustomerCandidate(own, { ...own, acquisitionChannelId: null }), true);
  assert.equal(sameCustomerCandidate({ ...own, name: ' ' }, { ...own, name: '' }), false);
});

test('search OR filters cannot overwrite joint-sales permission scope', () => {
  for (const role of ['SALES', 'BUSINESS_SUPERVISOR']) {
    const scope = customerScopeWhere({ id: 42, role });
    const query = { ...scope, OR: [{ name: { contains: 'known customer' } }] };
    assert.deepEqual(query.AND, scope.AND);
    assert.ok(JSON.stringify(query.AND).includes('salesMembers'));
    assert.ok(JSON.stringify(query.AND).includes('removedAt'));
  }
});
