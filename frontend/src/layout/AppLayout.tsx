import { Layout, Menu, Avatar, Card } from 'antd'
import type { MenuProps } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ROLE_LABEL } from '../api/types'
import ImpersonationBanner from '../components/ImpersonationBanner'
import NotificationBell from '../components/NotificationBell'
import PageHeader from '../components/PageHeader'

type Item = { key: string; cn: string; en: string; roles: string[]; admin?: boolean }

const NAV: Item[] = [
  { key: '/', cn: '仪表盘', en: 'DASHBOARD', roles: ['ADMIN', 'SALES', 'MARKET', 'BUSINESS_SUPERVISOR', 'DOWNSTREAM_SALES'] },
  { key: '/customers', cn: '客户 / 线索', en: 'CUSTOMERS', roles: ['ADMIN', 'SALES', 'MARKET', 'BUSINESS_SUPERVISOR'] },
  { key: '/orders', cn: '订单 / 签约', en: 'ORDERS', roles: ['ADMIN', 'SALES', 'BUSINESS_SUPERVISOR'] },
  { key: '/payments', cn: '收款 / 退款', en: 'PAYMENTS', roles: ['ADMIN', 'SALES', 'BUSINESS_SUPERVISOR'] },
  { key: '/commissions', cn: '分成 / 账目', en: 'SETTLEMENT', roles: ['ADMIN'] },
  { key: '/products', cn: '项目管理', en: 'PRODUCTS', roles: ['ADMIN'], admin: true },
  { key: '/channels', cn: '渠道管理', en: 'CHANNELS', roles: ['ADMIN', 'MARKET', 'BUSINESS_SUPERVISOR'], admin: true },
  { key: '/reports', cn: '报表', en: 'REPORTS', roles: ['ADMIN'], admin: true },
  { key: '/users', cn: '用户管理', en: 'USERS', roles: ['ADMIN'], admin: true },
  { key: '/audit-logs', cn: '操作日志', en: 'LOGS', roles: ['ADMIN'], admin: true },
]

const rowLabel = (cn: string, en: string) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <span>{cn}</span>
    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: 1 }}>{en}</span>
  </div>
)

export default function AppLayout() {
  const { user, logout } = useAuth()
  const loc = useLocation()
  const nav = useNavigate()
  const role = user?.role ?? ''
  const visible = NAV.filter((n) => n.roles.includes(role))
  const main = visible.filter((n) => !n.admin)
  const admin = visible.filter((n) => n.admin)

  const items: MenuProps['items'] = [
    ...main.map((n) => ({ key: n.key, label: rowLabel(n.cn, n.en) })),
    ...(admin.length
      ? [
          { type: 'divider' as const, style: { borderColor: 'rgba(255,255,255,0.18)', margin: '10px 16px' } },
          {
            type: 'group' as const,
            label: <span style={{ fontSize: 10, letterSpacing: 2, color: 'rgba(255,255,255,0.55)' }}>管理 · ADMIN</span>,
            children: admin.map((n) => ({ key: n.key, label: rowLabel(n.cn, n.en) })),
          },
        ]
      : []),
  ]

  const selected =
    NAV.map((n) => n.key)
      .filter((k) => k !== '/' && loc.pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0] ||
    (loc.pathname === '/' ? '/' : '')

  // 列表页自动套统一页头 + 白卡片；仪表盘 / 客户详情保留自己的布局
  const current = NAV.find((n) => n.key !== '/' && loc.pathname.startsWith(n.key))
  const isDetail = loc.pathname.startsWith('/customers/') || loc.pathname.startsWith('/orders/')
  const showHeader = !!current && !isDetail

  return (
    <Layout style={{ height: '100%' }}>
      <Layout.Sider width={224} style={{ background: 'linear-gradient(180deg, #14532d 0%, #2f7d4f 50%, #c2a02e 100%)', boxShadow: '4px 0 24px rgba(20, 83, 45, 0.22)', position: 'relative', zIndex: 2 }}>
        <div style={{ padding: '20px 18px 16px' }}>
          <div style={{ color: '#fff', fontWeight: 900, fontSize: 22, letterSpacing: 1 }}>矩阵 CRM</div>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, letterSpacing: 3, marginTop: 2 }}>MATRIX CRM</div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          items={items}
          onClick={({ key }) => nav(key)}
          style={{ background: 'transparent', borderInlineEnd: 'none', paddingBottom: 90 }}
        />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, borderTop: '1px solid rgba(255,255,255,0.22)', background: 'rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar shape="square" style={{ background: '#ffffff', color: '#166534', fontWeight: 700 }}>矩</Avatar>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{user?.name}</div>
              <div style={{ color: 'rgba(255,255,255,0.62)', fontSize: 11 }}>{user?.username} · {ROLE_LABEL[role]}</div>
            </div>
          </div>
          <a onClick={logout} style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12, display: 'inline-block', marginTop: 12 }}>退出登录</a>
        </div>
      </Layout.Sider>
      <Layout>
        <ImpersonationBanner />
        <Layout.Header style={{ background: 'transparent', padding: '0 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <NotificationBell />
        </Layout.Header>
        <Layout.Content style={{ margin: 12, padding: 16, overflow: 'auto' }}>
          {showHeader ? (
            <>
              <PageHeader eyebrow={current!.en} title={current!.cn} />
              <Card styles={{ body: { padding: 12 } }}>
                <Outlet />
              </Card>
            </>
          ) : (
            <Outlet />
          )}
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
