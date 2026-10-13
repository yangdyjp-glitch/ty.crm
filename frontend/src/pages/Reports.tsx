import { useEffect, useState } from 'react'
import { Card, DatePicker, Select, Space, Table, Tabs, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import client from '../api/client'
import { apiErrorMessage } from '../api/errors'
import {
  CURRENCY_LABEL,
  FUND_MODE_LABEL,
  fmtMoney,
} from '../api/types'
import { COL, smallTableProps } from '../components/tableLayout'

type Period = 'all' | 'year' | 'month'
type MoneyValue = number | string | null

type FinanceMetrics = {
  currency: string
  orderCount: number
  sharedOrderCount: number
  receivableAmount: MoneyValue
  channelPayable: MoneyValue
  channelSettled: MoneyValue
  pendingAgentDeduction: MoneyValue
  pendingRebate: MoneyValue
  companyActualReceived: MoneyValue
  balance: MoneyValue
}

type FinanceSummaryRow = FinanceMetrics & {
  confirmedReceived: MoneyValue
  unpaidAmount: MoneyValue
  refundAmount: MoneyValue
}

type FinanceModeRow = FinanceMetrics & { fundSettlementMode: string }
type FinanceSalesRow = FinanceMetrics & { salesUserId?: number | null; salesName: string }
type FinanceProductRow = FinanceMetrics & { productId: number; productName: string }

type FinanceReport = {
  summary: FinanceSummaryRow[]
  byMode: FinanceModeRow[]
  bySales: FinanceSalesRow[]
  byProduct: FinanceProductRow[]
}

type ChannelReportRow = {
  channelId: number
  currency: string
  channel?: { name: string } | null
  _count: number
  _sum?: {
    receivableAmount?: MoneyValue
    confirmedReceived?: MoneyValue
    orderUnpaidAmount?: MoneyValue
    payableAmount?: MoneyValue
    paidAmount?: MoneyValue
    unpaidAmount?: MoneyValue
    companyNetReceived?: MoneyValue
  }
}

type SalesReportRow = {
  ownerUserId: number
  name: string
  customerCount: number
  signedCount: number
  sharedCustomerCount: number
  sharedSignedCount: number
}

function reportParams(period: Period, year: Dayjs, month: Dayjs) {
  if (period === 'year') return { period, year: String(year.year()) }
  if (period === 'month') return { period, month: month.format('YYYY-MM') }
  return { period }
}

export default function Reports() {
  const [finance, setFinance] = useState<FinanceReport | null>(null)
  const [financeLoading, setFinanceLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('all')
  const [year, setYear] = useState(dayjs())
  const [month, setMonth] = useState(dayjs())
  const [channels, setChannels] = useState<ChannelReportRow[]>([])
  const [sales, setSales] = useState<SalesReportRow[]>([])
  const [channelsSalesLoading, setChannelsSalesLoading] = useState(true)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const params = reportParams(period, year, month)
    void Promise.resolve().then(async () => {
      if (!active) return
      setChannelsSalesLoading(true)
      try {
        const [channelsResponse, salesResponse] = await Promise.all([
          client.get<ChannelReportRow[]>('/reports/channels', { params, noCache: true, signal: controller.signal }),
          client.get<SalesReportRow[]>('/reports/sales', { params, noCache: true, signal: controller.signal }),
        ])
        if (!active) return
        setChannels(channelsResponse.data)
        setSales(salesResponse.data)
      } catch (error: unknown) {
        if (active) {
          setChannels([])
          setSales([])
          message.error(apiErrorMessage(error, '渠道与销售报表加载失败'))
        }
      } finally {
        if (active) setChannelsSalesLoading(false)
      }
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [period, year, month])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const params = reportParams(period, year, month)
    void Promise.resolve().then(async () => {
      if (!active) return
      setFinanceLoading(true)
      try {
        const response = await client.get<FinanceReport>('/reports/finance', {
          params,
          noCache: true,
          signal: controller.signal,
        })
        if (active) setFinance(response.data)
      } catch (error: unknown) {
        if (active) {
          setFinance(null)
          message.error(apiErrorMessage(error, '财务报表加载失败'))
        }
      } finally {
        if (active) setFinanceLoading(false)
      }
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [period, year, month])

  const periodFilter = (
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
  )

  return (
    <Tabs
      items={[
        {
          key: 'finance',
          label: '财务（分币种）',
          children: (
            <>
              {periodFilter}
              <Card title="公司现金总览（按币种）" size="small" style={{ marginBottom: 16 }}>
                <Table<FinanceSummaryRow>
                  {...smallTableProps}
                  className="finance-report-table"
                  scroll={undefined}
                  pagination={false}
                  rowKey={(r) => r.currency}
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
                <Table<FinanceModeRow>
                  {...smallTableProps}
                  className="finance-report-table"
                  scroll={undefined}
                  pagination={false}
                  rowKey={(r) => r.currency + r.fundSettlementMode}
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
              {periodFilter}
              <Card title="渠道统计" size="small" style={{ marginBottom: 16 }}>
                <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>
                  按订单签约时间统计，每笔订单仅计一次。单币种渠道显示一行，双币种渠道分行列示。
                  公司净入账 = 已收金额 − 已付／已代扣分成 − 公司承担的已支付退款。
                </div>
                <Table<ChannelReportRow>
                  {...smallTableProps}
                  className="finance-report-table"
                  scroll={undefined}
                  pagination={false}
                  rowKey={(r) => `${r.channelId}:${r.currency}`}
                  loading={channelsSalesLoading}
                  dataSource={channels}
                  columns={[
                    { title: '渠道', width: '20%', render: (_, r) => r.channel?.name || r.channelId },
                    { title: '币种', dataIndex: 'currency', width: '6%', render: (c: string) => CURRENCY_LABEL[c] },
                    { title: '订单数', dataIndex: '_count', width: '4%', align: 'right' },
                    { title: '合同总额', width: '10%', align: 'right', render: (_, r) => fmtMoney(r._sum?.receivableAmount) },
                    { title: '已收金额', width: '10%', align: 'right', render: (_, r) => fmtMoney(r._sum?.confirmedReceived) },
                    { title: '未收金额', width: '10%', align: 'right', render: (_, r) => fmtMoney(r._sum?.orderUnpaidAmount) },
                    { title: '渠道分成', width: '10%', align: 'right', render: (_, r) => fmtMoney(r._sum?.payableAmount) },
                    { title: '分成已付／已扣', width: '10%', align: 'right', render: (_, r) => fmtMoney(r._sum?.paidAmount) },
                    { title: '分成未付／未扣', width: '10%', align: 'right', render: (_, r) => fmtMoney(r._sum?.unpaidAmount) },
                    { title: '公司净入账', width: '10%', align: 'right', render: (_, r) => fmtMoney(r._sum?.companyNetReceived) },
                  ]}
                />
              </Card>
              <Card title="销售统计" size="small">
                <Table<SalesReportRow>
                  {...smallTableProps}
                  pagination={false}
                  rowKey={(r) => r.ownerUserId}
                  loading={channelsSalesLoading}
                  dataSource={sales}
                  columns={[
                    { title: '销售', dataIndex: 'name', width: COL.person },
                    { title: '负责客户数', dataIndex: 'customerCount', width: COL.count },
                    { title: '其中共同客户', dataIndex: 'sharedCustomerCount', width: COL.count },
                    { title: '签约数', dataIndex: 'signedCount', width: COL.count },
                    { title: '其中共同签约', dataIndex: 'sharedSignedCount', width: COL.count },
                  ]}
                />
              </Card>
              <Card title="销售业绩（个人全额口径，含共同订单）" size="small" style={{ marginBottom: 16 }}>
                <Table<FinanceSalesRow>
                  {...smallTableProps}
                  className="finance-report-table"
                  scroll={undefined}
                  pagination={false}
                  rowKey={(r) => `${r.currency}:${r.salesUserId ?? 'unassigned'}`}
                  loading={financeLoading}
                  dataSource={finance?.bySales || []}
                  columns={[
                    { title: '币种', dataIndex: 'currency', width: '6%', render: (c: string) => CURRENCY_LABEL[c] },
                    { title: '销售', dataIndex: 'salesName', width: '11%' },
                    { title: '订单 / 共同', width: '9%', align: 'right', render: (_, row) => `${row.orderCount} / ${row.sharedOrderCount ?? 0}` },
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
                <Table<FinanceProductRow>
                  {...smallTableProps}
                  className="finance-report-table"
                  scroll={undefined}
                  pagination={false}
                  rowKey={(r) => `${r.currency}:${r.productId}`}
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
