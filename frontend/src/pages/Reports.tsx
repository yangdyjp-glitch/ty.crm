import { useEffect, useState } from 'react'
import { Card, Table, Tabs } from 'antd'
import client from '../api/client'
import { CURRENCY_LABEL, FUND_MODE_LABEL, fmtMoney } from '../api/types'

type Any = Record<string, any>

export default function Reports() {
  const [finance, setFinance] = useState<Any | null>(null)
  const [channels, setChannels] = useState<Any[]>([])
  const [sales, setSales] = useState<Any[]>([])

  useEffect(() => {
    client.get('/reports/finance').then((r) => setFinance(r.data))
    client.get('/reports/channels').then((r) => setChannels(r.data))
    client.get('/reports/sales').then((r) => setSales(r.data))
  }, [])

  return (
    <Tabs
      items={[
        {
          key: 'finance',
          label: '财务（分币种）',
          children: (
            <>
              <Card title="订单金额" size="small" style={{ marginBottom: 16 }}>
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(r: Any) => r.currency}
                  dataSource={finance?.orders || []}
                  columns={[
                    { title: '币种', dataIndex: 'currency', render: (c: string) => CURRENCY_LABEL[c] },
                    { title: '应收', align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.receivableAmount) },
                    { title: '已收', align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.paidAmount) },
                    { title: '未收', align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.unpaidAmount) },
                    { title: '退款', align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.refundAmount) },
                  ]}
                />
              </Card>
              <Card title="渠道分成（按币种 × 模式）" size="small">
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(r: Any) => r.currency + r.fundSettlementMode}
                  dataSource={finance?.commissions || []}
                  columns={[
                    { title: '币种', dataIndex: 'currency', render: (c: string) => CURRENCY_LABEL[c] },
                    { title: '资金模式', dataIndex: 'fundSettlementMode', render: (m: string) => FUND_MODE_LABEL[m] },
                    { title: '应付', align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.payableAmount) },
                    { title: '已付', align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.paidAmount) },
                    { title: '未付', align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.unpaidAmount) },
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
              size="small"
              pagination={false}
              rowKey={(r: Any) => r.channelId + r.currency}
              dataSource={channels}
              columns={[
                { title: '渠道', render: (_: any, r: Any) => r.channel?.name || r.channelId },
                { title: '币种', dataIndex: 'currency', render: (c: string) => CURRENCY_LABEL[c] },
                { title: '笔数', dataIndex: '_count' },
                { title: '应付分成', align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.payableAmount) },
                { title: '已付', align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.paidAmount) },
                { title: '未付', align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.unpaidAmount) },
              ]}
            />
          ),
        },
        {
          key: 'sales',
          label: '销售',
          children: (
            <Table
              size="small"
              pagination={false}
              rowKey={(r: Any) => r.ownerUserId}
              dataSource={sales}
              columns={[
                { title: '销售', dataIndex: 'name' },
                { title: '负责客户数', dataIndex: 'customerCount' },
              ]}
            />
          ),
        },
      ]}
    />
  )
}
