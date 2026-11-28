import { createHash, createPublicKey, verify } from 'node:crypto';

export interface TyaiIdentity {
  kind: 'user' | 'directory' | 'provision';
  sub: string;
  local?: string;
  role?: string;
  login?: string;
  name?: string;
  sid?: string;
  phase?: 'prepare' | 'apply';
}

/** Railway supplies only the portal's public verification key to business modules. */
export function readTyai(raw: unknown, app: string, method: string, path: string): TyaiIdentity | null {
  if (raw == null) return null;
  try {
    if (typeof raw !== 'string' || raw.length > 6000) throw new Error();
    const [version, body, signature, extra] = raw.split('.');
    if (version !== 'v1' || !body || !signature || extra !== undefined) throw new Error();
    const key = createPublicKey({ key: Buffer.from(process.env.TYAI_PUBLIC_KEY || '', 'base64'), format: 'der', type: 'spki' });
    if (!verify(null, Buffer.from('v1.' + body), key, Buffer.from(signature, 'base64url'))) throw new Error();
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (data.iss !== 'tyai' || data.aud !== app || data.method !== method ||
        data.target !== createHash('sha256').update(path).digest('hex') ||
        !Number.isInteger(data.exp) || !Number.isInteger(data.iat) ||
        data.iat > now + 5 || data.exp <= now || data.exp - data.iat > 40 ||
        !['user', 'directory', 'provision'].includes(data.kind) || typeof data.sub !== 'string') throw new Error();
    return data;
  } catch {
    throw Object.assign(new Error('TYAI 身份验证失败'), { status: 401 });
  }
}

export function oldEntry(app: string, path: string) {
  const origin = new URL(process.env.TYAI_ORIGIN || 'http://localhost');
  return origin.origin + '/' + app + (path.startsWith('/') ? path : '/');
}
