import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Card, Col, Row, Segmented, Spin, Table, Tag } from 'antd'
import client from '../api/client'
import { CURRENCY_LABEL, CUSTOMER_STATUS_LABEL, fmtMoney } from '../api/types'
import { moneyIn, moneyOut } from '../api/money'
import { COL, smallTableProps } from '../components/tableLayout'
import { sortChannelLeadStats } from '../utils/channelSort'

type Any = Record<string, any>
type TrendPoint = { date: string; label: string; leads: number; signed: number }
type TrendRange = 15 | 30

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
        { title: '签约数', dataIndex: 'signedCount', width: COL.count, align: 'right' },
      ]}
    />
  )
}

function TrendChart({ rows }: { rows: TrendPoint[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [chartWidth, setChartWidth] = useState(960)
  const data = rows || []

  useEffect(() => {
    const node = wrapRef.current
    if (!node) return

    const syncWidth = () => {
      const next = Math.round(node.clientWidth)
      if (next > 0) setChartWidth(next)
    }

    syncWidth()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncWidth)
      return () => window.removeEventListener('resize', syncWidth)
    }

    const observer = new ResizeObserver(syncWidth)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  if (!data.length) return <div style={{ color: '#9ca3af', padding: 24 }}>暂无数据</div>

  const width = chartWidth
  const height = 318
  const left = 56
  const right = 28
  const top = 30
  const bottom = data.length > 18 ? 68 : 50
  const plotW = width - left - right
  const plotH = height - top - bottom
  const maxRaw = Math.max(1, ...data.flatMap((d) => [d.leads || 0, d.signed || 0]))
  const rawStep = maxRaw / 4
  const stepPower = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const stepRatio = rawStep / stepPower
  const stepUnit = stepRatio <= 1.5 ? 1 : stepRatio <= 2 ? 2 : stepRatio <= 2.5 ? 2.5 : stepRatio <= 5 ? 5 : 10
  const tickStep = maxRaw <= 4 ? 1 : stepUnit * stepPower
  const maxValue = maxRaw <= 4 ? 4 : tickStep * Math.ceil(maxRaw / tickStep)
  const xAt = (index: number) => left + (data.length === 1 ? 0 : (plotW * index) / (data.length - 1))
  const yAt = (value: number) => top + plotH - (plotH * value) / maxValue
  const pointsFor = (field: 'leads' | 'signed') =>
    data.map((d, i) => ({ x: xAt(i), y: yAt(d[field] || 0), value: d[field] || 0 }))
  const linePath = (field: 'leads' | 'signed') => {
    const points = pointsFor(field)
    return points.reduce((path, point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`
      const prev = points[index - 1]
      const midX = (prev.x + point.x) / 2
      return `${path} C ${midX} ${prev.y}, ${midX} ${point.y}, ${point.x} ${point.y}`
    }, '')
  }
  const areaPath = (field: 'leads' | 'signed') => {
    const points = pointsFor(field)
    const first = points[0]
    const last = points[points.length - 1]
    return `${linePath(field)} L ${last.x} ${top + plotH} L ${first.x} ${top + plotH} Z`
  }
  const gridStep = data.length <= 15 ? 1 : 5
  const yTicks = Array.from({ length: Math.floor(maxValue / tickStep) + 1 }, (_, i) => maxValue - i * tickStep)
  const formatTick = (value: number) => Number(value.toFixed(2)).toLocaleString('zh-CN')
  const canShowPoint = (value: number, index: number) => value > 0 || index === data.length - 1
  const tiltXLabels = data.length > 18

  return (
    <div ref={wrapRef} style={{ width: '100%', minHeight: 314, padding: '8px 14px 16px' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', width: '100%', height }}>
        <defs>
          <linearGradient id="trendLeadFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#15803d" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#15803d" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="trendSignedFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#b8860b" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#b8860b" stopOpacity="0" />
          </linearGradient>
          <filter id="trendLineShadow" x="-4%" y="-8%" width="108%" height="116%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#0f172a" floodOpacity="0.08" />
          </filter>
        </defs>
        <rect x={left} y={top} width={plotW} height={plotH} rx="10" fill="#fbfdf8" />
        <text x={left} y={18} fill="#64748b" fontSize="12">客户数量</text>
        {yTicks.map((tick) => {
          const y = yAt(tick)
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={width - right} y2={y} stroke={tick === 0 ? '#d4bb63' : '#e7ecd9'} strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <text x={left - 10} y={y + 4} textAnchor="end" fill="#7c8797" fontSize="12">{formatTick(tick)}</text>
            </g>
          )
        })}
        {data.map((d, i) => (
          (i % gridStep === 0 || i === data.length - 1) && (
            <line
              key={`grid-${d.date}`}
              x1={xAt(i)}
              y1={top}
              x2={xAt(i)}
              y2={height - bottom}
              stroke="#edf3e9"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )
        ))}
        <path d={areaPath('leads')} fill="url(#trendLeadFill)" />
        <path d={areaPath('signed')} fill="url(#trendSignedFill)" />
        <path d={linePath('leads')} fill="none" stroke="#15803d" strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" filter="url(#trendLineShadow)" vectorEffect="non-scaling-stroke" />
        <path d={linePath('signed')} fill="none" stroke="#b8860b" strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" filter="url(#trendLineShadow)" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => (
          <g key={d.date}>
            {canShowPoint(d.leads || 0, i) && (
              <>
                <circle cx={xAt(i)} cy={yAt(d.leads || 0)} r="5" fill="#ffffff" stroke="#15803d" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                <circle cx={xAt(i)} cy={yAt(d.leads || 0)} r="2.2" fill="#15803d" />
              </>
            )}
            {canShowPoint(d.signed || 0, i) && (
              <>
                <circle cx={xAt(i)} cy={yAt(d.signed || 0)} r="5" fill="#ffffff" stroke="#b8860b" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                <circle cx={xAt(i)} cy={yAt(d.signed || 0)} r="2.2" fill="#b8860b" />
              </>
            )}
            <text
              x={xAt(i)}
              y={height - (tiltXLabels ? 28 : 18)}
              textAnchor={tiltXLabels ? 'end' : 'middle'}
              fill="#7c8797"
              fontSize={tiltXLabels ? '10' : '11'}
              transform={tiltXLabels ? `rotate(-42 ${xAt(i)} ${height - 28})` : undefined}
            >
              {d.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState<Any | null>(null)
  const [loading, setLoading] = useState(true)
  const [trendDays, setTrendDays] = useState<TrendRange>(30)
  useEffect(() => {
    client.get('/reports/dashboard').then((r) => setData(r.data)).finally(() => setLoading(false))
  }, [])
  if (loading) return <Spin />
  if (!data) return null

  if (data.role === 'ADMIN') {
    const c = data.counts
    const trendRows = (data.trend || []).slice(-trendDays)
    const channelLeadStats = sortChannelLeadStats(data.leadStats?.channels)
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
        <SectionTitle eyebrow="TREND" title={`线索与签单趋势（近${trendDays}天）`} />
        <Card size="small" styles={{ body: { padding: 0, overflow: 'hidden' } }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '14px 16px 8px', borderBottom: '1px solid #edf2e6' }}>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', color: '#334155', fontSize: 13 }}>
              <span><i style={{ display: 'inline-block', width: 20, height: 3, borderRadius: 999, background: '#15803d', marginRight: 7, verticalAlign: 'middle' }} />线索数量</span>
              <span><i style={{ display: 'inline-block', width: 20, height: 3, borderRadius: 999, background: '#b8860b', marginRight: 7, verticalAlign: 'middle' }} />签单数量</span>
            </div>
            <Segmented
              size="small"
              value={trendDays}
              onChange={(value) => setTrendDays(value as TrendRange)}
              options={[
                { label: '近30天', value: 30 },
                { label: '近15天', value: 15 },
              ]}
            />
          </div>
          <TrendChart rows={trendRows} />
        </Card>
        <SectionTitle eyebrow="CHANNELS" title="按渠道统计客户线索" />
        <Card size="small">
          <LeadCountTable
            rows={channelLeadStats}
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
