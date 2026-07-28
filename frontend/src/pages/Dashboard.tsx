import { useEffect, useState, type ReactNode } from 'react'
import { Card, Col, Row, Spin, Table, Tag } from 'antd'
import client from '../api/client'
import { CURRENCY_LABEL, CUSTOMER_STATUS_LABEL, fmtMoney } from '../api/types'
import { moneyIn, moneyOut } from '../api/money'
import { COL, smallTableProps } from '../components/tableLayout'

type Any = Record<string, any>

function PageHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  const today = new Date()
  const d = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`
  return (
    <div style={{ borderBottom: '1px solid #d4bb63', paddingBottom: 10, marginBottom: 14 }}>
      <div style={{ fontSize: 11, letterSpacing: 3, color: '#15803d', textTransform: 'uppercase', marginBottom: 4, fontWeight: 700 }}>{eyebrow}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 1, color: '#0f172a' }}>{title}</div>
        <div style={{ color: '#9aa3b2', fontSize: 13 }}>数据快照 · {d}</div>
      </div>
    </div>
  )
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ margin: '14px 0 8px' }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: '#15803d', textTransform: 'uppercase', fontWeight: 700 }}>{eyebrow}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{title}</div>
    </div>
  )
}

function Stat({ title, value, unit, color }: { title: string; value: ReactNode; unit?: string; color: string }) {
  return (
    <Card styles={{ body: { padding: '11px 16px' } }}>
      <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 36, fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
        {unit && <span style={{ color: '#9ca3af', fontSize: 13 }}>{unit}</span>}
      </div>
    </Card>
  )
}

function MoneyByCurrency({ rows, fields }: { rows: Any[]; fields: [string, string, ('in' | 'out')?][] }) {
  return (
    <Table
      {...smallTableProps}
      pagination={false}
      rowKey={(r) => r.currency}
      dataSource={rows || []}
      columns={[
        { title: '币种', dataIndex: 'currency', width: COL.currency, render: (c) => <b>{CURRENCY_LABEL[c] || c}</b> },
        ...fields.map(([key, title, tone]) => ({
          title,
          width: COL.money,
          align: 'right' as const,
          render: (_: any, r: Any) => {
            const val = r._sum?.[key]
            return tone === 'in' ? moneyIn(val) : tone === 'out' ? moneyOut(val) : fmtMoney(val)
          },
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

  if (data.role === 'ADMIN') {
    const c = data.counts
    const cards: [string, number, string, string][] = [
      ['客户总数', c.custTotal, '位', '#166534'],
      ['今日新增', c.newToday, '', '#15803d'],
      ['本月新增', c.newMonth, '', '#059669'],
      ['本月签约', c.signedMonth, '单', '#b8860b'],
      ['待审核分成', c.pendingReview, '', '#f59e0b'],
      ['待确认收款', c.pendingPay, '', '#10b981'],
      ['问题客户', c.problem, '', '#ef4444'],
    ]
    return (
      <div>
        <PageHead eyebrow="总览 · OVERVIEW" title="数据总览" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 14px' }}>
          {cards.map(([t, v, unit, color]) => (
            <div key={t} style={{ flex: '1 1 160px', minWidth: 0 }}>
              <Stat title={t} value={v} unit={unit} color={color} />
            </div>
          ))}
        </div>
        <SectionTitle eyebrow="FINANCE" title="订单金额（分币种）" />
        <Card size="small">
          <MoneyByCurrency rows={data.byCurrency?.orders} fields={[['receivableAmount', '应收'], ['paidAmount', '已收', 'in'], ['unpaidAmount', '未收'], ['refundAmount', '退款', 'out']]} />
        </Card>
        <SectionTitle eyebrow="COMMISSION" title="渠道分成（模式二·分币种）" />
        <Card size="small">
          <MoneyByCurrency rows={data.byCurrency?.commissions} fields={[['payableAmount', '应付'], ['paidAmount', '已付'], ['unpaidAmount', '未付']]} />
        </Card>
      </div>
    )
  }

  if (data.role === 'SALES') {
    const c = data.counts
    return (
      <div>
        <PageHead eyebrow="总览 · OVERVIEW" title="我的业绩" />
        <Row gutter={[14, 10]}>
          <Col xs={12} lg={8}><Stat title="我的客户" value={c.myCustomers} unit="位" color="#166534" /></Col>
          <Col xs={12} lg={8}><Stat title="逾期未跟进" value={c.overdue} color="#ef4444" /></Col>
          <Col xs={12} lg={8}><Stat title="本月签约" value={c.signedMonth} unit="单" color="#15803d" /></Col>
        </Row>
        <SectionTitle eyebrow="FINANCE" title="我的订单金额（分币种）" />
        <Card size="small">
          <MoneyByCurrency rows={data.byCurrency?.orders} fields={[['receivableAmount', '应收'], ['paidAmount', '已收', 'in']]} />
        </Card>
      </div>
    )
  }

  if (data.role === 'BUSINESS_SUPERVISOR') {
    const c = data.counts
    const cards: [string, number, string, string][] = [
      ['我登记的线索', c.registeredTotal, '位', '#166534'],
      ['本月登记', c.registeredMonth, '', '#15803d'],
      ['负责客户', c.myCustomers, '位', '#059669'],
      ['逾期未跟进', c.overdue, '', '#ef4444'],
      ['本月签约', c.signedMonth, '单', '#b8860b'],
    ]
    return (
      <div>
        <PageHead eyebrow="总览 · OVERVIEW" title="营业主管总览" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 14px' }}>
          {cards.map(([t, v, unit, color]) => (
            <div key={t} style={{ flex: '1 1 160px', minWidth: 0 }}>
              <Stat title={t} value={v} unit={unit} color={color} />
            </div>
          ))}
        </div>
        <SectionTitle eyebrow="FINANCE" title="负责订单金额（分币种）" />
        <Card size="small">
          <MoneyByCurrency rows={data.byCurrency?.orders} fields={[['receivableAmount', '应收'], ['paidAmount', '已收', 'in']]} />
        </Card>
        <SectionTitle eyebrow="STATUS" title="登记线索按状态分布" />
        <Card size="small">
          {(data.byStatus || []).map((s: Any) => (
            <Tag key={s.mainStatus} color="blue" style={{ marginBottom: 8, fontSize: 14, padding: '2px 10px' }}>
              {CUSTOMER_STATUS_LABEL[s.mainStatus]}：{s._count}
            </Tag>
          ))}
        </Card>
      </div>
    )
  }

  if (data.role === 'DOWNSTREAM_SALES') {
    return (
      <div>
        <PageHead eyebrow="总览 · OVERVIEW" title="我的转介绍收佣" />
        <Card size="small">
          <Table
            {...smallTableProps}
            pagination={false}
            rowKey={(r) => r.currency + r.collectionStatus}
            dataSource={data.referrals || []}
            columns={[
              { title: '币种', dataIndex: 'currency', width: COL.currency, render: (c) => <b>{CURRENCY_LABEL[c]}</b> },
              { title: '状态', dataIndex: 'collectionStatus', width: COL.status, render: (s) => (s === 'COLLECTED' ? '已收款' : '待收款') },
              { title: '笔数', dataIndex: '_count', width: COL.count },
              { title: '金额', width: COL.money, align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.commissionAmount) },
            ]}
          />
        </Card>
      </div>
    )
  }

  const c = data.counts
  return (
    <div>
      <PageHead eyebrow="总览 · OVERVIEW" title="我登记的线索" />
      <Row gutter={[14, 10]}>
        <Col xs={12} lg={8}><Stat title="我登记的客户" value={c.total} unit="位" color="#166534" /></Col>
        <Col xs={12} lg={8}><Stat title="本月登记" value={c.newMonth} color="#15803d" /></Col>
      </Row>
      <SectionTitle eyebrow="STATUS" title="按状态分布" />
      <Card size="small">
        {(data.byStatus || []).map((s: Any) => (
          <Tag key={s.mainStatus} color="blue" style={{ marginBottom: 8, fontSize: 14, padding: '2px 10px' }}>
            {CUSTOMER_STATUS_LABEL[s.mainStatus]}：{s._count}
          </Tag>
        ))}
      </Card>
    </div>
  )
}
