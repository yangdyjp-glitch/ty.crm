const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Exercise the real Axios client and its interceptors without a browser or network.
function loadModule(filename, localRequire, storage, window) {
  const source = fs.readFileSync(path.join(__dirname, '../src', filename), 'utf8')
    .replace('import.meta.env.VITE_API_BASE', "'https://legacy.test/api'");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'localStorage', 'window', outputText)(
    localRequire, mod, mod.exports, storage, window,
  );
  return mod.exports;
}

function api(pathname = '/') {
  const storage = { getItem: () => 'legacy-browser-token', removeItem() {} };
  const sessionData = new Map();
  const window = {
    location: { pathname, search: '', hash: '', href: pathname },
    sessionStorage: { getItem: (key) => sessionData.get(key) ?? null, removeItem: (key) => sessionData.delete(key) },
  };
  const portal = loadModule('portal.ts', require, storage, window);
  const localRequire = (id) => id === '../portal' ? portal : require(id);
  const client = loadModule('api/client.ts', localRequire, storage, window).default;
  const calls = [];
  client.defaults.adapter = async (config) => {
    calls.push(config);
    return { data: { revision: calls.length }, status: 200, statusText: 'OK', headers: {}, config };
  };
  return { client, calls, portal, sessionData };
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

test('TYAI uses its own origin, rechecks cached reads and ignores standalone credentials', async () => {
  const { client, calls } = api('/crm/customers/12');
  await client.get('/customers/12', { headers: { Authorization: 'Bearer old' } });
  await client.get('/customers/12');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.baseURL, '/crm/api');
    assert.equal(call.headers.get('Authorization'), undefined);
    assert.equal(call.headers.get('X-TYAI-Request'), '1');
  }
});

test('only a CRM impersonation token from the current portal tab is forwarded', async () => {
  const { client, calls, portal, sessionData } = api('/crm/');
  sessionData.set(portal.impersonationKey, 'test-impersonation');
  await client.get('/auth/me');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer test-impersonation');
  assert.equal(portal.portalLoginUrl(), '/?next=%2Fcrm%2F');
});

test('standalone CRM keeps its existing API and login token', async () => {
  const { client, calls } = api('/orders/5');
  await client.get('/orders/5');
  assert.equal(calls[0].baseURL, 'https://legacy.test/api');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer legacy-browser-token');
});
