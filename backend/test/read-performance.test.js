const test = require('node:test');
const assert = require('node:assert/strict');
const { readPage } = require('../dist/common/read-page');
const { databaseOptions } = require('../dist/prisma/database-options');

test('full-list totals come from the returned records without a second query', async () => {
  const unexpected = () => { throw new Error('Unnecessary database round trip'); };
  for (const rows of [[], [{ id: 8 }, { id: 9 }]]) {
    const [items, total] = await readPage({ $transaction: unexpected }, true, Promise.resolve(rows), unexpected);
    assert.deepEqual(items, rows);
    assert.equal(total, rows.length);
  }
});

test('paginated totals still count all matches, not only the current page', async () => {
  const prisma = { $transaction: (queries) => Promise.all(queries) };
  const result = await readPage(prisma, false, Promise.resolve([{ id: 9 }]), () => Promise.resolve(205));
  assert.deepEqual(result, [[{ id: 9 }], 205]);
});

test('runtime connections use a bounded pool without changing database identity', () => {
  const source = 'postgresql://example:local-test@localhost:5432/crm?sslmode=require';
  const url = new URL(databaseOptions(source).datasources.db.url);
  const original = new URL(source);
  for (const key of ['protocol', 'username', 'password', 'host', 'pathname']) assert.equal(url[key], original[key]);
  assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(url.searchParams.get('connection_limit'), '3');
  assert.equal(url.searchParams.get('connect_timeout'), '15');
});

test('explicit deployment pool and timeout settings are preserved', () => {
  const source = 'postgresql://localhost/crm?connection_limit=5&connect_timeout=30&pgbouncer=true';
  const url = new URL(databaseOptions(source).datasources.db.url);
  assert.equal(url.searchParams.get('connection_limit'), '5');
  assert.equal(url.searchParams.get('connect_timeout'), '30');
  assert.equal(url.searchParams.get('pgbouncer'), 'true');
});
