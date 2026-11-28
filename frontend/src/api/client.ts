import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import { impersonationKey, inPortal, portalLoginUrl } from '../portal';

// 生产环境用 VITE_API_BASE（指向后端公网地址 + /api）；开发用 vite 代理的 /api
const baseURL = inPortal ? '/crm/api' : import.meta.env.VITE_API_BASE || '/api';

export interface ApiRequestConfig<D = unknown> extends AxiosRequestConfig<D> {
  noCache?: boolean;
}

type ApiClient = Omit<AxiosInstance, 'get'> & {
  get<T = unknown, D = unknown>(
    url: string,
    config?: ApiRequestConfig<D>,
  ): Promise<AxiosResponse<T, D>>;
};

const axiosClient = axios.create({ baseURL });
const client = axiosClient as ApiClient;
const rawGet = axiosClient.get.bind(axiosClient);

axiosClient.interceptors.request.use((config) => {
  const token = inPortal
    ? window.sessionStorage.getItem(impersonationKey)
    : localStorage.getItem('token');
  if (inPortal) {
    config.headers.delete('Authorization');
    config.headers.set('X-TYAI-Request', '1');
  }
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

axiosClient.interceptors.response.use(
  (r) => r,
  (err) => {
    if (inPortal && err.response?.status === 401) {
      if (err.config?.url !== '/auth/me') {
        window.sessionStorage.removeItem(impersonationKey);
        window.location.replace(portalLoginUrl());
      }
    } else if (err.response?.status === 401 && !window.location.pathname.includes('/login')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

// ===== GET 响应缓存 =====
// 页面间切换直接走缓存、不重复请求；任何写操作后自动失效；浏览器主动刷新（清空内存）才会重新加载。
type CacheEntry = { t: number; response: AxiosResponse<unknown> };
const getCache = new Map<string, CacheEntry>();
const cacheRequestVersions = new Map<string, number>();
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟
let cacheGeneration = 0;

client.get = async function cachedGet<T = unknown, D = unknown>(
  url: string,
  config?: ApiRequestConfig<D>,
): Promise<AxiosResponse<T, D>> {
  // blob 下载、或显式 noCache 不走缓存
  if (inPortal || config?.responseType === 'blob' || config?.noCache) {
    return rawGet<T, AxiosResponse<T, D>, D>(url, config);
  }
  const key = url + '|' + JSON.stringify(config?.params ?? {});
  if (config?.signal?.aborted) {
    throw new axios.CanceledError('canceled');
  }
  const hit = getCache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) {
    return hit.response as AxiosResponse<T, D>;
  }
  const requestVersion = (cacheRequestVersions.get(key) ?? 0) + 1;
  cacheRequestVersions.set(key, requestVersion);
  const requestGeneration = cacheGeneration;
  const response = await rawGet<T, AxiosResponse<T, D>, D>(url, config);
  // A GET that started before a successful write must not repopulate stale cache data.
  if (
    requestGeneration === cacheGeneration &&
    cacheRequestVersions.get(key) === requestVersion
  ) {
    getCache.set(key, {
      t: Date.now(),
      response: response as AxiosResponse<unknown>,
    });
  }
  return response;
};

// 查重是只读 POST；输入姓名时不要反复清空渠道、销售等选项缓存。
// 其他写操作成功后清空缓存，保证数据不陈旧。
axiosClient.interceptors.response.use((res) => {
  const method = (res.config.method ?? 'get').toLowerCase();
  const readOnlyPost = method === 'post' && res.config.url === '/customers/check-duplicate';
  if (method !== 'get' && !readOnlyPost) clearApiCache();
  return res;
});

/** 手动清空接口缓存（供"刷新"按钮等调用） */
export function clearApiCache() {
  cacheGeneration += 1;
  getCache.clear();
  cacheRequestVersions.clear();
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
