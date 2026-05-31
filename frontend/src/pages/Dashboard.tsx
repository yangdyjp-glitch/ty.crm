import { useEffect, useState, type ReactNode } from 'react'
import { Card, Col, Row, Spin, Table, Tag, Typography } from 'antd'
import {
  TeamOutlined,
  UserAddOutlined,
  UsergroupAddOutlined,
  FileDoneOutlined,
  AuditOutlined,
  WalletOutlined,
  WarningOutlined,
  RiseOutlined,
} from '@ant-design/icons'
import client from '../api/client'
import { CURRENCY_LABEL, CUSTOMER_STATUS_LABEL, fmtMoney } from '../api/types'

type Any = Record<string, any>

function Stat({ title, value, color, icon }: { title: string; value: ReactNode; color: string; icon: ReactNode }) {
  return (
    <Card styles={{ body: { padding: '16px 20px' } }} style={{ borderLeft: `5px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#64748b', fontSize: 13 }}>{title}</div>
          <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1.2, marginTop: 6 }}>{value}</div>
        </div>
        <div style={{ fontSize: 36, color, opacity: 0.2 }}>{icon}</div>
      </div>
    </Card>
  )
}

function MoneyByCurrency({ rows, fields }: { rows: Any[]; fields: [string, string][] }) {
  return (
    <Table
      size="small"
      pagination={false}
      rowKey={(r) => r.currency}
      dataSource={rows || []}
      columns={[
        { title: '币种', dataIndex: 'currency', render: (c) => <b>{CURRENCY_LABEL[c] || c}</b> },
        ...fields.map(([key, title]) => ({
          title,
          align: 'right' as const,
          render: (_: any, r: Any) => fmtMoney(r._sum?.[key]),
        })),
      ]}
    />
  )
}

export default function Dashboard() {
  const [data, setData] = useState<Any | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    client.get('/reports/dashboard').then((r) => setData(r.data)).finally(() => setLoading(false))
  }, [])
  if (loading) return <Spin />
  if (!data) return null

  const Title = ({ children }: { children: ReactNode }) => (
    <Typography.Title level={3} style={{ margin: '0 0 18px', fontWeight: 900, letterSpacing: 1 }}>
      {children}
    </Typography.Title>
  )

  if (data.role === 'ADMIN') {
    const c = data.counts
    const cards: [string, number, string, ReactNode][] = [
      ['客户总数', c.custTotal, '#2563eb', <TeamOutlined />],
      ['今日新增', c.newToday, '#06b6d4', <UserAddOutlined />],
      ['本月新增', c.newMonth, '#8b5cf6', <UsergroupAddOutlined />],
      ['本月签约', c.signedMonth, '#10b981', <FileDoneOutlined />],
      ['待审核分成', c.pendingReview, '#f59e0b', <AuditOutlined />],
      ['待确认收款', c.pendingPay, '#0ea5e9', <WalletOutlined />],
      ['问题客户', c.problem, '#ef4444', <WarningOutlined />],
    ]
    return (
      <div>
        <Title>数据总览</Title>
        <Row gutter={[16, 16]}>
          {cards.map(([t, v, color, icon]) => (
            <Col key={t} xs={12} sm={8} lg={6}>
              <Stat title={t} value={v} color={color} icon={icon} />
            </Col>
          ))}
        </Row>
        <Card title="订单金额（分币种）" size="small" style={{ marginTop: 20 }}>
          <MoneyByCurrency rows={data.byCurrency?.orders} fields={[['receivableAmount', '应收'], ['paidAmount', '已收'], ['unpaidAmount', '未收'], ['refundAmount', '退款']]} />
        </Card>
        <Card title="渠道分成（模式二·分币种）" size="small" style={{ marginTop: 16 }}>
          <MoneyByCurrency rows={data.byCurrency?.commissions} fields={[['payableAmount', '应付'], ['paidAmount', '已付'], ['unpaidAmount', '未付']]} />
        </Card>
      </div>
    )
  }

  if (data.role === 'SALES') {
    const c = data.counts
    return (
      <div>
        <Title>我的业绩</Title>
        <Row gutter={[16, 16]}>
          <Col xs={12} lg={8}><Stat title="我的客户" value={c.myCustomers} color="#2563eb" icon={<TeamOutlined />} /></Col>
          <Col xs={12} lg={8}><Stat title="逾期未跟进" value={c.overdue} color="#ef4444" icon={<WarningOutlined />} /></Col>
          <Col xs={12} lg={8}><Stat title="本月签约" value={c.signedMonth} color="#10b981" icon={<RiseOutlined />} /></Col>
        </Row>
        <Card title="我的订单金额（分币种）" size="small" style={{ marginTop: 20 }}>
          <MoneyByCurrency rows={data.byCurrency?.orders} fields={[['receivableAmount', '应收'], ['paidAmount', '已收']]} />
        </Card>
      </div>
    )
  }

  if (data.role === 'DOWNSTREAM_SALES') {
    return (
      <div>
        <Title>我的转介绍收佣</Title>
        <Card size="small">
          <Table
            size="small"
            pagination={false}
            rowKey={(r) => r.currency + r.collectionStatus}
            dataSource={data.referrals || []}
            columns={[
              { title: '币种', dataIndex: 'currency', render: (c) => <b>{CURRENCY_LABEL[c]}</b> },
              { title: '状态', dataIndex: 'collectionStatus', render: (s) => (s === 'COLLECTED' ? '已收款' : '待收款') },
              { title: '笔数', dataIndex: '_count' },
              { title: '金额', align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.commissionAmount) },
            ]}
          />
        </Card>
      </div>
    )
  }

  const c = data.counts
  return (
    <div>
      <Title>我登记的线索</Title>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={8}><Stat title="我登记的客户" value={c.total} color="#2563eb" icon={<TeamOutlined />} /></Col>
        <Col xs={12} lg={8}><Stat title="本月登记" value={c.newMonth} color="#8b5cf6" icon={<UserAddOutlined />} /></Col>
      </Row>
      <Card title="按状态分布" size="small" style={{ marginTop: 20 }}>
        {(data.byStatus || []).map((s: Any) => (
          <Tag key={s.mainStatus} color="blue" style={{ marginBottom: 8, fontSize: 14, padding: '2px 10px' }}>
            {CUSTOMER_STATUS_LABEL[s.mainStatus]}：{s._count}
          </Tag>
        ))}
      </Card>
    </div>
  )
}
