const { PrismaClient } = require('@prisma/client');
const { CustomersService } = require('../dist/customers/customers.service');
const { OrdersService } = require('../dist/orders/orders.service');
const { PaymentsService } = require('../dist/payments/payments.service');
const { CommissionsService } = require('../dist/commissions/commissions.service');
const { ReportsService } = require('../dist/reports/reports.service');
const { databaseOptions } = require('../dist/prisma/database-options');
const { createHash } = require('node:crypto');

// Read-only profiling: no credentials, customer records or SQL parameters are printed.
const base = new PrismaClient({
  ...databaseOptions(),
  log: [{ emit: 'event', level: 'query' }],
});
let queryCount = 0;
let queryMs = 0;
base.$on('query', (event) => { queryCount++; queryMs += event.duration; });
const allowed = new Set(['findUnique', 'findFirst', 'findMany', 'findUniqueOrThrow', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']);
const db = base.$extends({
  query: {
    $allOperations({ operation, args, query }) {
      if (!allowed.has(operation)) throw new Error('Profiling only permits model reads');
      return query(args);
    },
  },
});
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
async function main() {
  const start = performance.now();
  await base.$connect();
  console.log(JSON.stringify({ connectionMs: Math.round(performance.now() - start) }));
  const user = { id: 0, role: 'ADMIN', username: 'read-only-profile' };
  const customers = new CustomersService(db);
  const commissions = new CommissionsService(db, {}, {});
  const reports = new ReportsService(db);
  const jobs = [
    ['customers', () => customers.list(user, { all: '1' })],
    ['orders', () => new OrdersService(db, customers, commissions).list(user, { all: '1' })],
    ['payments', () => new PaymentsService(db, commissions).list(user, { all: '1' })],
    ['cash', () => commissions.cashAccounts({ all: '1' })],
    ['commissions', () => commissions.list({ all: '1' })],
    ['finance', () => reports.finance({ period: 'all' })],
    ['channels', () => reports.channels({ period: 'all' })],
    ['sales', () => reports.sales({ period: 'all' })],
    ['dashboard', () => reports.dashboard(user)],
  ];
  for (const [name, run] of jobs) {
    queryCount = 0;
    queryMs = 0;
    const started = performance.now();
    const data = JSON.stringify(await run());
    console.log(JSON.stringify({
      name, ms: Math.round(performance.now() - started), queries: queryCount,
      dbMs: queryMs, bytes: Buffer.byteLength(data),
      digest: createHash('sha256').update(JSON.stringify(canonical(JSON.parse(data)))).digest('hex'),
    }));
  }
}
main().catch((error) => {
  // Prisma connection errors can contain connection details, so only print the code.
  console.error(JSON.stringify({ error: error.code || error.name }));
  process.exitCode = 1;
}).finally(() => base.$disconnect());
