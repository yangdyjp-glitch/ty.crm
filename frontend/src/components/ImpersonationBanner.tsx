import { Button, message } from 'antd'
import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'

export default function ImpersonationBanner() {
  const { user, stopImpersonating } = useAuth()
  const [loading, setLoading] = useState(false)

  if (!user?.impersonator) return null

  const stop = async () => {
    setLoading(true)
    try {
      await stopImpersonating()
      window.location.assign('/')
    } catch (e: any) {
      message.error(e.response?.data?.message || '退出代理登录失败')
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        padding: '8px 24px',
        background: '#7f1d1d',
        color: '#fff',
        boxShadow: '0 2px 12px rgba(127, 29, 29, 0.22)',
      }}
    >
      <span style={{ fontWeight: 700 }}>
        你（{user.impersonator.name}）正在以 {user.name} 的身份操作
      </span>
      <Button size="small" onClick={stop} loading={loading}>
        返回我的账户
      </Button>
    </div>
  )
}
