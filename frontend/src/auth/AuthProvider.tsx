import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Result, message } from 'antd'
import { isAxiosError } from 'axios'
import client, { clearApiCache } from '../api/client'
import { impersonationKey, inPortal, portalLoginUrl } from '../portal'
import {
  AuthContext,
  type AuthContextValue,
  type AuthRole,
  type AuthUser,
  type AuthUserIdentity,
} from './AuthContext'

interface AuthResponse {
  token: string
  user: AuthUser
}

const AUTH_ROLES = new Set<AuthRole>([
  'ADMIN',
  'MARKET',
  'SALES',
  'BUSINESS_SUPERVISOR',
  'DOWNSTREAM_SALES',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAuthRole(value: unknown): value is AuthRole {
  return typeof value === 'string' && AUTH_ROLES.has(value as AuthRole)
}

function isAuthUserIdentity(value: unknown): value is AuthUserIdentity {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.username === 'string' &&
    typeof value.name === 'string' &&
    isAuthRole(value.role)
  )
}

function isAuthUser(value: unknown): value is AuthUser {
  if (!isAuthUserIdentity(value)) return false
  return (
    !('impersonator' in value) ||
    value.impersonator == null ||
    isAuthUserIdentity(value.impersonator)
  )
}

function storedUser(): AuthUser | null {
  if (inPortal) return null
  const serialized = localStorage.getItem('user')
  if (!serialized) return null
  try {
    const parsed: unknown = JSON.parse(serialized)
    return isAuthUser(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function portalUser(signal: AbortSignal) {
  const getMe = () => client.get<AuthUser>('/auth/me', { signal, noCache: true })
  let response
  try {
    response = await getMe()
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status : undefined
    if (signal.aborted || (status !== 401 && status !== 403) || !window.sessionStorage.getItem(impersonationKey)) throw error
    // A former administrator's per-tab impersonation may outlive their TYAI session.
    window.sessionStorage.removeItem(impersonationKey)
    response = await getMe()
  }
  if (!isAuthUser(response.data)) throw new Error('CRM 未返回有效的用户身份')
  return response.data
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(storedUser)
  const [access, setAccess] = useState<'checking' | 'ready' | 'denied' | 'failed'>(inPortal ? 'checking' : 'ready')
  const [retry, setRetry] = useState(0)
  const sessionRequest = useRef(0)

  useEffect(() => {
    if (!inPortal) return
    let lastRequest: AbortController | undefined
    const verify = async () => {
      lastRequest?.abort()
      const request = new AbortController()
      lastRequest = request
      try {
        const current = await portalUser(request.signal)
        if (request.signal.aborted) return
        setUser(current)
        setAccess('ready')
      } catch (error) {
        if (request.signal.aborted) return
        const status = isAxiosError(error) ? error.response?.status : undefined
        if (status === 401) {
          window.location.replace(portalLoginUrl())
          return
        }
        setUser(null)
        setAccess(status === 403 ? 'denied' : 'failed')
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void verify()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void verify()
    }
    void verify()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      lastRequest?.abort()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [retry])

  const setSession = useCallback((token: string, nextUser: AuthUser) => {
    clearApiCache()
    if (inPortal) {
      if (nextUser.impersonator) window.sessionStorage.setItem(impersonationKey, token)
      else window.sessionStorage.removeItem(impersonationKey)
    } else {
      localStorage.setItem('token', token)
      localStorage.setItem('user', JSON.stringify(nextUser))
    }
    setUser(nextUser)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    if (inPortal) {
      window.location.replace(portalLoginUrl())
      return
    }
    const requestId = ++sessionRequest.current
    const { data } = await client.post<AuthResponse>('/auth/login', { username, password })
    if (requestId === sessionRequest.current) setSession(data.token, data.user)
  }, [setSession])

  const impersonate = useCallback(async (userId: number) => {
    const requestId = ++sessionRequest.current
    const { data } = await client.post<AuthResponse>('/auth/impersonate', { userId })
    if (requestId === sessionRequest.current) setSession(data.token, data.user)
  }, [setSession])

  const stopImpersonating = useCallback(async () => {
    const requestId = ++sessionRequest.current
    const { data } = await client.post<AuthResponse>('/auth/stop-impersonating')
    if (requestId === sessionRequest.current) setSession(data.token, data.user)
  }, [setSession])

  const logout = useCallback(async () => {
    sessionRequest.current += 1
    clearApiCache()
    if (inPortal) {
      try {
        const response = await fetch('/api/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-TYAI-Request': '1', 'Content-Type': 'application/json' },
          body: '{}',
        })
        if (!response.ok && response.status !== 401) throw new Error()
        window.sessionStorage.removeItem(impersonationKey)
        setUser(null)
        window.location.replace('/')
      } catch {
        message.error('退出登录失败，请重试')
      }
      return
    }
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
    window.location.href = '/login'
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, login, impersonate, stopImpersonating, logout }),
    [impersonate, login, logout, stopImpersonating, user],
  )

  if (access === 'checking') return <Result title="正在确认 CRM 访问权限…" />
  if (access !== 'ready') {
    const denied = access === 'denied'
    return <Result
      status={denied ? '403' : 'warning'}
      title={denied ? '当前账号没有 CRM 访问权限' : '暂时无法确认 CRM 登录状态'}
      extra={[
        <Button key="home" href="/">返回 TYAI</Button>,
        <Button key="retry" onClick={() => { setAccess('checking'); setRetry(n => n + 1) }}>重试</Button>,
      ]}
    />
  }
  const identity = inPortal ? `${user?.id}/${user?.role}/${user?.impersonator?.id ?? ''}` : 'crm'
  return <AuthContext.Provider key={identity} value={value}>{children}</AuthContext.Provider>
}
