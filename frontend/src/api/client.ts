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
