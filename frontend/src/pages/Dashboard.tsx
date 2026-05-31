import { useEffect, useState } from 'react'
import { Card, Col, Row, Spin, Statistic, Table, Tag } from 'antd'
import client from '../api/client'
import { CURRENCY_LABEL, CUSTOMER_STATUS_LABEL, fmtMoney } from '../api/types'

type Any = Record<string, any>

function MoneyByCurrency({ rows, fields }: { rows: Any[]; fields: [string, string][] }) {
  return (
    <Table
      size="small"
      pagination={false}
      rowKey={(r) => r.currency}
      dataSource={rows || []}
      columns={[
        { title: '币种', dataIndex: 'currency', render: (c) => CURRENCY_LABEL[c] || c },
        ...fields.map(([key, title]) => ({
          title,
          render: (_: any, r: Any) => fmtMoney(r._sum?.[key]),
          align: 'right' as const,
        })),
      ]}
    />
  )
}

export default function Dashboard() {
  const [data, setData] = useState<Any | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    client
      .get('/reports/dashboard')
      .then((r) => setData(r.data))
      .finally(() => setLoading(false))
  }, [])
  if (loading) return <Spin />
  if (!data) return null

  if (data.role === 'ADMIN') {
    const c = data.counts
    return (
      <div>
        <Row gutter={16}>
          {[
            ['客户总数', c.custTotal],
            ['今日新增', c.newToday],
            ['本月新增', c.newMonth],
            ['本月签约', c.signedMonth],
            ['待审核分成', c.pendingReview],
            ['待确认收款', c.pendingPay],
            ['问题客户', c.problem],
          ].map(([t, v]) => (
            <Col key={t as string} span={6} style={{ marginBottom: 16 }}>
              <Card>
                <Statistic title={t as string} value={v as number} />
              </Card>
            </Col>
          ))}
        </Row>
        <Card title="订单金额（分币种）" size="small" style={{ marginTop: 8 }}>
          <MoneyByCurrency
            rows={data.byCurrency?.orders}
            fields={[
              ['receivableAmount', '应收'],
              ['paidAmount', '已收'],
              ['unpaidAmount', '未收'],
              ['refundAmount', '退款'],
            ]}
          />
        </Card>
        <Card title="渠道分成（模式二，分币种）" size="small" style={{ marginTop: 16 }}>
          <MoneyByCurrency
            rows={data.byCurrency?.commissions}
            fields={[
              ['payableAmount', '应付'],
              ['paidAmount', '已付'],
              ['unpaidAmount', '未付'],
            ]}
          />
        </Card>
      </div>
    )
  }

  if (data.role === 'SALES') {
    const c = data.counts
    return (
      <Row gutter={16}>
        {[
          ['我的客户', c.myCustomers],
          ['逾期未跟进', c.overdue],
          ['本月签约', c.signedMonth],
        ].map(([t, v]) => (
          <Col key={t as string} span={8}>
            <Card>
              <Statistic title={t as string} value={v as number} />
            </Card>
          </Col>
        ))}
        <Col span={24} style={{ marginTop: 16 }}>
          <Card title="我的订单金额（分币种）" size="small">
            <MoneyByCurrency
              rows={data.byCurrency?.orders}
              fields={[
                ['receivableAmount', '应收'],
                ['paidAmount', '已收'],
              ]}
            />
          </Card>
        </Col>
      </Row>
    )
  }

  if (data.role === 'DOWNSTREAM_SALES') {
    return (
      <Card title="我的转介绍收佣（分币种）" size="small">
        <Table
          size="small"
          pagination={false}
          rowKey={(r) => r.currency + r.collectionStatus}
          dataSource={data.referrals || []}
          columns={[
            { title: '币种', dataIndex: 'currency', render: (c) => CURRENCY_LABEL[c] },
            { title: '状态', dataIndex: 'collectionStatus', render: (s) => (s === 'COLLECTED' ? '已收款' : '待收款') },
            { title: '笔数', dataIndex: '_count' },
            { title: '金额', align: 'right', render: (_: any, r: Any) => fmtMoney(r._sum?.commissionAmount) },
          ]}
        />
      </Card>
    )
  }

  // MARKET
  const c = data.counts
  return (
    <Row gutter={16}>
      <Col span={8}>
        <Card>
          <Statistic title="我登记的客户" value={c.total} />
        </Card>
      </Col>
      <Col span={8}>
        <Card>
          <Statistic title="本月登记" value={c.newMonth} />
        </Card>
      </Col>
      <Col span={24} style={{ marginTop: 16 }}>
        <Card title="按状态分布" size="small">
          {(data.byStatus || []).map((s: Any) => (
            <Tag key={s.mainStatus} style={{ marginBottom: 8 }}>
              {CUSTOMER_STATUS_LABEL[s.mainStatus]}：{s._count}
            </Tag>
          ))}
        </Card>
      </Col>
    </Row>
  )
}
