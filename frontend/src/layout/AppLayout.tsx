import { Layout, Menu, Dropdown, Avatar, Tag } from 'antd'
import { UserOutlined, DownOutlined } from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ROLE_LABEL } from '../api/types'
import NotificationBell from '../components/NotificationBell'

const NAV: { key: string; label: string; roles: string[] }[] = [
  { key: '/', label: '仪表盘', roles: ['ADMIN', 'SALES', 'MARKET', 'DOWNSTREAM_SALES'] },
  { key: '/customers', label: '客户 / 线索', roles: ['ADMIN', 'SALES', 'MARKET'] },
  { key: '/orders', label: '订单 / 签约', roles: ['ADMIN', 'SALES'] },
  { key: '/payments', label: '收款', roles: ['ADMIN', 'SALES'] },
  { key: '/refunds', label: '退款', roles: ['ADMIN', 'SALES'] },
  { key: '/commissions', label: '分成结算', roles: ['ADMIN'] },
  { key: '/channels', label: '渠道管理', roles: ['ADMIN', 'MARKET'] },
  { key: '/products', label: '项目管理', roles: ['ADMIN'] },
  { key: '/referrals', label: '转介绍收佣', roles: ['ADMIN', 'DOWNSTREAM_SALES'] },
  { key: '/reports', label: '报表', roles: ['ADMIN'] },
  { key: '/users', label: '用户管理', roles: ['ADMIN'] },
  { key: '/audit-logs', label: '操作日志', roles: ['ADMIN'] },
]

export default function AppLayout() {
  const { user, logout } = useAuth()
  const loc = useLocation()
  const nav = useNavigate()
  const role = user?.role ?? ''

  const items = NAV.filter((n) => n.roles.includes(role)).map((n) => ({
    key: n.key,
    label: n.label,
  }))

  // 当前选中项：精确或前缀匹配（客户详情高亮“客户”）
  const selected =
    NAV.map((n) => n.key)
      .filter((k) => k !== '/' && loc.pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0] ||
    (loc.pathname === '/' ? '/' : '')

  return (
    <Layout style={{ height: '100%' }}>
      <Layout.Sider theme="light" width={200} style={{ borderRight: '1px solid #f0f0f0' }}>
        <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 900, fontSize: 19, color: '#2563eb', letterSpacing: 1, borderBottom: '1px solid #e6ebf2' }}>
          <span style={{ background: 'linear-gradient(135deg,#2563eb,#06b6d4)', color: '#fff', borderRadius: 8, padding: '2px 8px', fontSize: 15 }}>矩阵</span>
          CRM
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          items={items}
          onClick={({ key }) => nav(key)}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', borderBottom: '1px solid #f0f0f0' }}>
          <NotificationBell />
          <Dropdown
            menu={{ items: [{ key: 'logout', label: '退出登录', onClick: logout }] }}
          >
            <span style={{ cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} style={{ marginRight: 8 }} />
              {user?.name} <Tag color="blue" style={{ marginLeft: 4 }}>{ROLE_LABEL[role]}</Tag>
              <DownOutlined style={{ fontSize: 10 }} />
            </span>
          </Dropdown>
        </Layout.Header>
        <Layout.Content style={{ margin: 16, padding: 16, background: '#fff', overflow: 'auto' }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
