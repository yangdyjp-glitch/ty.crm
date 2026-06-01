import axios from 'axios';

// 生产环境用 VITE_API_BASE（指向后端公网地址 + /api）；开发用 vite 代理的 /api
const baseURL = (import.meta.env as any).VITE_API_BASE || '/api';

const client = axios.create({ baseURL });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (r) => r,
  (err) => {
    if (
      err.response?.status === 401 &&
      !window.location.pathname.includes('/login')
    ) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

// ===== GET 响应缓存 =====
// 页面间切换直接走缓存、不重复请求；任何写操作后自动失效；浏览器主动刷新（清空内存）才会重新加载。
type CacheEntry = { t: number; data: unknown };
const getCache = new Map<string, CacheEntry>();
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟

const rawGet = client.get.bind(client);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(client as any).get = (url: string, config?: any) => {
  // blob 下载、或显式 noCache 不走缓存
  if (config?.responseType === 'blob' || config?.noCache) return rawGet(url, config);
  const key = url + '|' + JSON.stringify(config?.params ?? {});
  const hit = getCache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) {
    return Promise.resolve({ data: hit.data, status: 200, statusText: 'OK', headers: {}, config: config ?? {} });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rawGet(url, config).then((res: any) => {
    getCache.set(key, { t: Date.now(), data: res.data });
    return res;
  });
};

// 写操作（POST/PUT/PATCH/DELETE）成功后清空缓存，保证数据不陈旧
client.interceptors.response.use((res) => {
  if ((res.config.method ?? 'get').toLowerCase() !== 'get') getCache.clear();
  return res;
});

/** 手动清空接口缓存（供"刷新"按钮等调用） */
export function clearApiCache() {
  getCache.clear();
}

/** 带鉴权地下载文件（导出 / 附件），用 blob 触发浏览器保存 */
export async function downloadFile(url: string, filename: string) {
  const res = await client.get(url, { responseType: 'blob' });
  const blobUrl = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

export default client;
