import { Layout, Menu, Avatar, Card } from 'antd'
import type { MenuProps } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ROLE_LABEL } from '../api/types'
import NotificationBell from '../components/NotificationBell'
import PageHeader from '../components/PageHeader'

type Item = { key: string; cn: string; en: string; roles: string[]; admin?: boolean }

const NAV: Item[] = [
  { key: '/', cn: '仪表盘', en: 'DASHBOARD', roles: ['ADMIN', 'SALES', 'MARKET', 'DOWNSTREAM_SALES'] },
  { key: '/customers', cn: '客户 / 线索', en: 'CUSTOMERS', roles: ['ADMIN', 'SALES', 'MARKET'] },
  { key: '/orders', cn: '订单 / 签约', en: 'ORDERS', roles: ['ADMIN', 'SALES'] },
  { key: '/payments', cn: '收款', en: 'PAYMENTS', roles: ['ADMIN', 'SALES'] },
  { key: '/refunds', cn: '退款', en: 'REFUNDS', roles: ['ADMIN', 'SALES'] },
  { key: '/commissions', cn: '分成结算', en: 'SETTLEMENT', roles: ['ADMIN'] },
  { key: '/channels', cn: '渠道管理', en: 'CHANNELS', roles: ['ADMIN', 'MARKET'] },
  { key: '/referrals', cn: '转介绍收佣', en: 'REFERRALS', roles: ['ADMIN', 'DOWNSTREAM_SALES'] },
  { key: '/products', cn: '项目管理', en: 'PRODUCTS', roles: ['ADMIN'], admin: true },
  { key: '/reports', cn: '报表', en: 'REPORTS', roles: ['ADMIN'], admin: true },
  { key: '/users', cn: '用户管理', en: 'USERS', roles: ['ADMIN'], admin: true },
  { key: '/audit-logs', cn: '操作日志', en: 'LOGS', roles: ['ADMIN'], admin: true },
]

const rowLabel = (cn: string, en: string) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <span>{cn}</span>
    <span style={{ fontSize: 10, color: '#5f6b7d', letterSpacing: 1 }}>{en}</span>
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
          { type: 'divider' as const, style: { borderColor: '#2b3547', margin: '10px 16px' } },
          {
            type: 'group' as const,
            label: <span style={{ fontSize: 10, letterSpacing: 2, color: '#5f6b7d' }}>管理 · ADMIN</span>,
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
  const isDetail = loc.pathname.startsWith('/customers/')
  const showHeader = !!current && !isDetail

  return (
    <Layout style={{ height: '100%' }}>
      <Layout.Sider width={224} style={{ background: '#1e2433' }}>
        <div style={{ padding: '20px 18px 16px' }}>
          <div style={{ color: '#fff', fontWeight: 900, fontSize: 22, letterSpacing: 1 }}>矩阵 CRM</div>
          <div style={{ color: '#5f6b7d', fontSize: 11, letterSpacing: 3, marginTop: 2 }}>MATRIX CRM</div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          items={items}
          onClick={({ key }) => nav(key)}
          style={{ background: 'transparent', borderInlineEnd: 'none', paddingBottom: 90 }}
        />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, borderTop: '1px solid #2b3547', background: '#1e2433' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar shape="square" style={{ background: '#2563eb', fontWeight: 700 }}>矩</Avatar>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{user?.name}</div>
              <div style={{ color: '#5f6b7d', fontSize: 11 }}>{user?.username} · {ROLE_LABEL[role]}</div>
            </div>
          </div>
          <a onClick={logout} style={{ color: '#8b95a5', fontSize: 12, display: 'inline-block', marginTop: 12 }}>退出登录</a>
        </div>
      </Layout.Sider>
      <Layout>
        <Layout.Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', borderBottom: '1px solid #e6ebf2' }}>
          <NotificationBell />
        </Layout.Header>
        <Layout.Content style={{ margin: 16, padding: 24, overflow: 'auto' }}>
          {showHeader ? (
            <>
              <PageHeader eyebrow={current!.en} title={current!.cn} />
              <Card styles={{ body: { padding: 16 } }}>
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
