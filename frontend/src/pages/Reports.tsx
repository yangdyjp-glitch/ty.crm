import { useEffect, useState } from 'react'
import { Card, DatePicker, Select, Space, Table, Tabs } from 'antd'
import dayjs from 'dayjs'
import client from '../api/client'
import {
  CURRENCY_LABEL,
  FUND_MODE_LABEL,
  SALES_STAGE_LABEL,
  fmtMoney,
} from '../api/types'
import { COL, smallTableProps } from '../components/tableLayout'

type Any = Record<string, any>
type Period = 'all' | 'year' | 'month'

export default function Reports() {
  const [finance, setFinance] = useState<Any | null>(null)
  const [financeLoading, setFinanceLoading] = useState(false)
  const [period, setPeriod] = useState<Period>('all')
  const [year, setYear] = useState(dayjs())
  const [month, setMonth] = useState(dayjs())
  const [channels, setChannels] = useState<Any[]>([])
  const [sales, setSales] = useState<Any[]>([])
  const [funnel, setFunnel] = useState<Any[]>([])

  useEffect(() => {
    client.get('/reports/channels').then((r) => setChannels(r.data))
    client.get('/reports/sales').then((r) => setSales(r.data))
    client.get('/reports/funnel').then((r) => setFunnel(r.data))
  }, [])

  useEffect(() => {
    const params =
      period === 'year'
        ? { period, year: String(year.year()) }
        : period === 'month'
          ? { period, month: month.format('YYYY-MM') }
          : { period }
    setFinanceLoading(true)
    client.get('/reports/finance', { params }).then((r) => setFinance(r.data)).finally(() => setFinanceLoading(false))
  }, [period, year, month])

  return (
    <Tabs
      items={[
        {
          key: 'finance',
          label: '财务（分币种）',
          children: (
            <>
              <Space style={{ marginBottom: 12 }} wrap>
                <Select
                  value={period}
                  style={{ width: 120 }}
                  onChange={(v) => setPeriod(v)}
                  options={[
                    { value: 'all', label: '全部' },
                    { value: 'year', label: '按年' },
                    { value: 'month', label: '按月' },
                  ]}
                />
                {period === 'year' && (
                  <DatePicker picker="year" value={year} allowClear={false} onChange={(v) => setYear(v || dayjs())} />
                )}
                {period === 'month' && (
                  <DatePicker picker="month" value={month} allowClear={false} onChange={(v) => setMonth(v || dayjs())} />
                )}
              </Space>
              <Card title="公司现金总览（按币种）" size="small" style={{ marginBottom: 16 }}>
                <Table
                  {...smallTableProps}
                  pagination={false}
                  rowKey={(r: Any) => r.currency}
                  loading={financeLoading}
                  dataSource={finance?.summary || []}
                  columns={[
                    { title: '币种', dataIndex: 'currency', width: COL.currency, render: (c: string) => CURRENCY_LABEL[c] },
                    { title: '订单数', dataIndex: 'orderCount', width: COL.count, align: 'right' },
                    { title: '应收金额', dataIndex: 'receivableAmount', width: COL.money, render: fmtMoney, align: 'right' },
                    { title: '确认到账', dataIndex: 'confirmedReceived', width: COL.money, render: fmtMoney, align: 'right' },
                    { title: '未收金额', dataIndex: 'unpaidAmount', width: COL.money, render: fmtMoney, align: 'right' },
                    { title: '退款金额', dataIndex: 'refundAmount', width: COL.money, render: fmtMoney, align: 'right' },
                    { title: '渠道分成应付', dataIndex: 'channelPayable', width: COL.money, render: fmtMoney, align: 'right' },
                    { title: '渠道已扣/已付', dataIndex: 'channelSettled', width: COL.money, render: fmtMoney, align: 'right' },
                    { title: '待返佣', dataIndex: 'pendingRebate', width: COL.money, render: fmtMoney, align: 'right' },
                    { title: '公司实际入账', dataIndex: 'companyActualReceived', width: COL.money, render: fmtMoney, align: 'right' },
                    { title: '当前结余', dataIndex: 'balance', width: COL.money, render: fmtMoney, align: 'right' },
                  ]}
                />
              </Card>
              <Card title="资金模式拆分（按币种 × 模式）" size="small">
                <Table
                  {...smallTableProps}
                  pagination={false}
                  rowKey={(r: Any) => r.currency + r.fundSettlementMode}
                  loading={financeLoading}
                  dataSource={finance?.byMode || []}
                  columns={[
                    { title: '币种', dataIndex: 'currency', width: COL.currency, render: (c: string) => CURRENCY_LABEL[c] },
                    { title: '资金模式', dataIndex: 'fundSettlementMode', width: COL.mode, render: (m: string) => FUND_MODE_LABEL[m] },
                    { title: '订单数', dataIndex: 'orderCount', width: COL.count, align: 'right' },
                    { title: '应收金额', dataIndex: 'receivableAmount', width: COL.money, render: fmtMoney, align: 'right' },
                    { title: '渠道分成应付', dataIndex: 'channelPayable', width: COL.money, render: fmtMoney, align: 'right' },
                    { title: '渠道已扣/已付', dataIndex: 'channelSettled', width: COL.money, render: fmtMoney, align: 'right' },
                    { title: '待返佣', dataIndex: 'pendingRebate', width: COL.money, render: fmtMoney, align: 'right' },
                    { title: '公司实际入账', dataIndex: 'companyActualReceived', width: COL.money, render: fmtMoney, align: 'right' },
                    { title: '当前结余', dataIndex: 'balance', width: COL.money, render: fmtMoney, align: 'right' },
                  ]}
                />
              </Card>
            </>
          ),
        },
        {
          key: 'channels',
          label: '渠道',
          children: (
            <Table
              {...smallTableProps}
              pagination={false}
              rowKey={(r: Any) => r.channelId + r.currency}
              dataSource={channels}
              columns={[
                { title: '渠道', width: COL.channel, render: (_: any, r: Any) => r.channel?.name || r.channelId },
                { title: '币种', dataIndex: 'currency', width: COL.currency, render: (c: string) => CURRENCY_LABEL[c] },
                { title: '笔数', dataIndex: '_count', width: COL.count },
                { title: '应付分成', width: COL.money, align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.payableAmount) },
                { title: '已付', width: COL.money, align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.paidAmount) },
                { title: '未付', width: COL.money, align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.unpaidAmount) },
              ]}
            />
          ),
        },
        {
          key: 'sales',
          label: '销售',
          children: (
            <Table
              {...smallTableProps}
              pagination={false}
              rowKey={(r: Any) => r.ownerUserId}
              dataSource={sales}
              columns={[
                { title: '销售', dataIndex: 'name', width: COL.person },
                { title: '负责客户数', dataIndex: 'customerCount', width: COL.count },
                { title: '签约数', dataIndex: 'signedCount', width: COL.count },
              ]}
            />
          ),
        },
        {
          key: 'funnel',
          label: '销售漏斗',
          children: (() => {
            const map: Record<string, number> = Object.fromEntries(
              funnel.map((f) => [f.salesStage, f._count]),
            )
            const max = Math.max(1, ...funnel.map((f) => f._count))
            return (
              <div style={{ maxWidth: 520 }}>
                {Object.entries(SALES_STAGE_LABEL).map(([k, v]) => {
                  const cnt = map[k] || 0
                  return (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ width: 84, textAlign: 'right', marginRight: 12 }}>{v}</div>
                      <div style={{ flex: 1, background: '#f0f0f0', borderRadius: 0 }}>
                        <div
                          style={{
                            width: `${(cnt / max) * 100}%`,
                            minWidth: cnt ? 28 : 0,
                            background: '#15803d',
                            color: '#fff',
                            padding: '2px 8px',
                            borderRadius: 0,
                            fontSize: 12,
                            textAlign: 'right',
                          }}
                        >
                          {cnt || ''}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })(),
        },
      ]}
    />
  )
}
