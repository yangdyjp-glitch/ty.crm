import { useEffect, useState } from 'react'
import { Card, DatePicker, Select, Space, Table, Tabs } from 'antd'
import dayjs from 'dayjs'
import client from '../api/client'
import {
  CURRENCY_LABEL,
  FUND_MODE_LABEL,
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

  useEffect(() => {
    client.get('/reports/channels').then((r) => setChannels(r.data))
    client.get('/reports/sales').then((r) => setSales(r.data))
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
                  className="finance-report-table"
                  scroll={undefined}
                  pagination={false}
                  rowKey={(r: Any) => r.currency}
                  loading={financeLoading}
                  dataSource={finance?.summary || []}
                  columns={[
                    { title: '币种', dataIndex: 'currency', width: '5%', render: (c: string) => CURRENCY_LABEL[c] },
                    { title: '订单', dataIndex: 'orderCount', width: '5%', align: 'right' },
                    { title: '应收', dataIndex: 'receivableAmount', width: '9%', render: fmtMoney, align: 'right' },
                    { title: '到账', dataIndex: 'confirmedReceived', width: '9%', render: fmtMoney, align: 'right' },
                    { title: '未收', dataIndex: 'unpaidAmount', width: '9%', render: fmtMoney, align: 'right' },
                    { title: '退款', dataIndex: 'refundAmount', width: '9%', render: fmtMoney, align: 'right' },
                    { title: '分成应付', dataIndex: 'channelPayable', width: '9%', render: fmtMoney, align: 'right' },
                    { title: '已扣/已付', dataIndex: 'channelSettled', width: '9%', render: fmtMoney, align: 'right' },
                    { title: '待扣/未实现', dataIndex: 'pendingAgentDeduction', width: '9%', render: fmtMoney, align: 'right' },
                    { title: '待返佣', dataIndex: 'pendingRebate', width: '9%', render: fmtMoney, align: 'right' },
                    { title: '公司入账', dataIndex: 'companyActualReceived', width: '9%', render: fmtMoney, align: 'right' },
                    { title: '结余', dataIndex: 'balance', width: '9%', render: fmtMoney, align: 'right' },
                  ]}
                />
              </Card>
              <Card title="资金模式拆分（按币种 × 模式）" size="small" style={{ marginBottom: 16 }}>
                <Table
                  {...smallTableProps}
                  className="finance-report-table"
                  scroll={undefined}
                  pagination={false}
                  rowKey={(r: Any) => r.currency + r.fundSettlementMode}
                  loading={financeLoading}
                  dataSource={finance?.byMode || []}
                  columns={[
                    { title: '币种', dataIndex: 'currency', width: '6%', render: (c: string) => CURRENCY_LABEL[c] },
                    { title: '资金模式', dataIndex: 'fundSettlementMode', width: '14%', render: (m: string) => FUND_MODE_LABEL[m] },
                    { title: '订单', dataIndex: 'orderCount', width: '6%', align: 'right' },
                    { title: '应收', dataIndex: 'receivableAmount', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '分成应付', dataIndex: 'channelPayable', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '已扣/已付', dataIndex: 'channelSettled', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '待扣/未实现', dataIndex: 'pendingAgentDeduction', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '待返佣', dataIndex: 'pendingRebate', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '公司入账', dataIndex: 'companyActualReceived', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '结余', dataIndex: 'balance', width: '10.5%', render: fmtMoney, align: 'right' },
                  ]}
                />
              </Card>
            </>
          ),
        },
        {
          key: 'channels-sales',
          label: '渠道 / 销售',
          children: (
            <>
              <Card title="渠道统计" size="small" style={{ marginBottom: 16 }}>
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
              </Card>
              <Card title="销售统计" size="small">
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
              </Card>
              <Card title="销售拆分（按币种 × 销售）" size="small" style={{ marginBottom: 16 }}>
                <Table
                  {...smallTableProps}
                  className="finance-report-table"
                  scroll={undefined}
                  pagination={false}
                  rowKey={(r: Any) => `${r.currency}:${r.salesUserId ?? 'unassigned'}`}
                  loading={financeLoading}
                  dataSource={finance?.bySales || []}
                  columns={[
                    { title: '币种', dataIndex: 'currency', width: '6%', render: (c: string) => CURRENCY_LABEL[c] },
                    { title: '销售', dataIndex: 'salesName', width: '14%' },
                    { title: '订单', dataIndex: 'orderCount', width: '6%', align: 'right' },
                    { title: '应收', dataIndex: 'receivableAmount', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '分成应付', dataIndex: 'channelPayable', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '已扣/已付', dataIndex: 'channelSettled', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '待扣/未实现', dataIndex: 'pendingAgentDeduction', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '待返佣', dataIndex: 'pendingRebate', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '公司入账', dataIndex: 'companyActualReceived', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '结余', dataIndex: 'balance', width: '10.5%', render: fmtMoney, align: 'right' },
                  ]}
                />
              </Card>
              <Card title="产品拆分（按币种 × 产品）" size="small">
                <Table
                  {...smallTableProps}
                  className="finance-report-table"
                  scroll={undefined}
                  pagination={false}
                  rowKey={(r: Any) => `${r.currency}:${r.productId}`}
                  loading={financeLoading}
                  dataSource={finance?.byProduct || []}
                  columns={[
                    { title: '币种', dataIndex: 'currency', width: '6%', render: (c: string) => CURRENCY_LABEL[c] },
                    { title: '产品', dataIndex: 'productName', width: '14%' },
                    { title: '订单', dataIndex: 'orderCount', width: '6%', align: 'right' },
                    { title: '应收', dataIndex: 'receivableAmount', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '分成应付', dataIndex: 'channelPayable', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '已扣/已付', dataIndex: 'channelSettled', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '待扣/未实现', dataIndex: 'pendingAgentDeduction', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '待返佣', dataIndex: 'pendingRebate', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '公司入账', dataIndex: 'companyActualReceived', width: '10.5%', render: fmtMoney, align: 'right' },
                    { title: '结余', dataIndex: 'balance', width: '10.5%', render: fmtMoney, align: 'right' },
                  ]}
                />
              </Card>
            </>
          ),
        },
      ]}
    />
  )
}
