const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Exercise the real Axios client and its interceptors without a browser or network.
function api() {
  const source = fs.readFileSync(path.join(__dirname, '../src/api/client.ts'), 'utf8')
    .replace('import.meta.env.VITE_API_BASE', "'/api'");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'localStorage', 'window', outputText)(
    require, mod, mod.exports, { getItem: () => null, removeItem() {} }, { location: { pathname: '/', href: '/' } },
  );
  const client = mod.exports.default;
  const calls = [];
  client.defaults.adapter = async (config) => {
    calls.push(config);
    return { data: { revision: calls.length }, status: 200, statusText: 'OK', headers: {}, config };
  };
  return { client, calls };
}

test('customer duplicate checks preserve loaded channel options', async () => {
  const { client, calls } = api();
  const first = await client.get('/channels/options');
  await client.post('/customers/check-duplicate', { name: 'sample' });
  const second = await client.get('/channels/options');
  assert.deepEqual(second.data, first.data);
  assert.equal(calls.filter((request) => request.method === 'get').length, 1);
});

test('actual mutations still refresh cached options and business data', async () => {
  for (const method of ['post', 'patch', 'put', 'delete']) {
    const { client } = api();
    const first = await client.get('/channels/options');
    await client[method]('/channels/2', {});
    const second = await client.get('/channels/options');
    assert.notDeepEqual(second.data, first.data);
  }
});

test('financial requests marked noCache always fetch fresh records', async () => {
  const { client } = api();
  const first = await client.get('/commissions', { noCache: true });
  const second = await client.get('/commissions', { noCache: true });
  assert.notDeepEqual(second.data, first.data);
});
