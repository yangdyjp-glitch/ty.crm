import { useEffect, useState, type ReactNode } from 'react'
import { Card, Col, Row, Spin, Table, Tag } from 'antd'
import client from '../api/client'
import { CURRENCY_LABEL, CUSTOMER_STATUS_LABEL, fmtMoney } from '../api/types'
import { moneyIn, moneyOut } from '../api/money'
import { COL, smallTableProps } from '../components/tableLayout'

type Any = Record<string, any>
type TrendPoint = { date: string; label: string; leads: number; signed: number }

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

function LeadCountTable({
  rows,
  rowKey,
  nameTitle,
  extraColumns = [],
}: {
  rows: Any[]
  rowKey: (r: Any) => string | number
  nameTitle: string
  extraColumns?: Any[]
}) {
  return (
    <Table
      {...smallTableProps}
      pagination={false}
      rowKey={rowKey}
      dataSource={rows || []}
      columns={[
        ...extraColumns,
        { title: nameTitle, dataIndex: 'name', width: COL.name },
        { title: '客户线索数', dataIndex: 'customerCount', width: COL.count, align: 'right' },
      ]}
    />
  )
}

function TrendChart({ rows }: { rows: TrendPoint[] }) {
  const data = rows || []
  if (!data.length) return <div style={{ color: '#9ca3af', padding: 24 }}>暂无数据</div>

  const width = 760
  const height = 260
  const left = 46
  const right = 22
  const top = 24
  const bottom = 42
  const plotW = width - left - right
  const plotH = height - top - bottom
  const maxRaw = Math.max(1, ...data.flatMap((d) => [d.leads || 0, d.signed || 0]))
  const maxValue = Math.max(1, Math.ceil(maxRaw / 5) * 5)
  const xAt = (index: number) => left + (data.length === 1 ? 0 : (plotW * index) / (data.length - 1))
  const yAt = (value: number) => top + plotH - (plotH * value) / maxValue
  const linePath = (field: 'leads' | 'signed') =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(d[field] || 0)}`).join(' ')
  const labelStep = Math.max(1, Math.ceil(data.length / 6))
  const yTicks = Array.from(new Set([maxValue, Math.round(maxValue / 2), 0]))

  return (
    <div style={{ width: '100%', minHeight: 282 }}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', justifyContent: 'flex-end', marginBottom: 8, color: '#374151', fontSize: 13 }}>
        <span><i style={{ display: 'inline-block', width: 18, height: 3, background: '#15803d', marginRight: 6, verticalAlign: 'middle' }} />线索数量</span>
        <span><i style={{ display: 'inline-block', width: 18, height: 3, background: '#b8860b', marginRight: 6, verticalAlign: 'middle' }} />签单数量</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', width: '100%', height: 260 }}>
        <text x={left} y={14} fill="#64748b" fontSize="12">客户数量</text>
        {yTicks.map((tick) => {
          const y = yAt(tick)
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={width - right} y2={y} stroke="#e5d48a" strokeWidth="1" opacity={tick === 0 ? 1 : 0.65} />
              <text x={left - 10} y={y + 4} textAnchor="end" fill="#64748b" fontSize="12">{tick}</text>
            </g>
          )
        })}
        <line x1={left} y1={top} x2={left} y2={height - bottom} stroke="#d4bb63" strokeWidth="1" />
        <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} stroke="#d4bb63" strokeWidth="1" />
        <path d={linePath('leads')} fill="none" stroke="#15803d" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        <path d={linePath('signed')} fill="none" stroke="#b8860b" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={d.date}>
            <circle cx={xAt(i)} cy={yAt(d.leads || 0)} r="3" fill="#15803d" />
            <circle cx={xAt(i)} cy={yAt(d.signed || 0)} r="3" fill="#b8860b" />
            {(i % labelStep === 0 || i === data.length - 1) && (
              <text x={xAt(i)} y={height - 18} textAnchor="middle" fill="#64748b" fontSize="11">{d.label}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
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
        <SectionTitle eyebrow="TREND" title="线索与签单趋势（近30天）" />
        <Card size="small">
          <TrendChart rows={data.trend || []} />
        </Card>
        <SectionTitle eyebrow="CHANNELS" title="按渠道统计客户线索" />
        <Card size="small">
          <LeadCountTable
            rows={data.leadStats?.channels}
            rowKey={(r) => r.key}
            nameTitle="渠道"
            extraColumns={[{ title: '类型', dataIndex: 'type', width: COL.type }]}
          />
        </Card>
        <SectionTitle eyebrow="PRODUCTS" title="按产品统计客户线索" />
        <Card size="small">
          <LeadCountTable
            rows={data.leadStats?.products}
            rowKey={(r) => r.productId}
            nameTitle="产品"
            extraColumns={[{ title: '类别', dataIndex: 'category', width: COL.type, render: (v: string) => v || '—' }]}
          />
        </Card>
        <SectionTitle eyebrow="SALES" title="按销售统计客户线索" />
        <Card size="small">
          <LeadCountTable
            rows={data.leadStats?.sales}
            rowKey={(r) => r.ownerUserId}
            nameTitle="销售"
          />
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
