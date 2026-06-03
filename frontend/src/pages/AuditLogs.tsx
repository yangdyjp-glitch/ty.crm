import { useEffect, useState } from 'react'
import { Table, Tag } from 'antd'
import dayjs from 'dayjs'
import client from '../api/client'

type Any = Record<string, any>

const ACTION_LABEL: Record<string, string> = {
  APPROVE_REFUND: '执行退款',
  PAY_COMMISSION: '支付分成',
}

export default function AuditLogs() {
  const [rows, setRows] = useState<Any[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setLoading(true)
    client.get('/audit-logs').then((r) => setRows(r.data)).finally(() => setLoading(false))
  }, [])

  return (
    <Table
      rowKey="id"
      loading={loading}
      dataSource={rows}
      columns={[
        { title: '时间', dataIndex: 'createdAt', render: (t) => dayjs(t).format('YYYY-MM-DD HH:mm:ss') },
        { title: '操作人ID', dataIndex: 'operatorId' },
        { title: '对象', dataIndex: 'relatedType', render: (t, r: Any) => `${t}#${r.relatedId ?? ''}` },
        { title: '动作', dataIndex: 'action', render: (a) => <Tag>{ACTION_LABEL[a] || a}</Tag> },
        { title: '详情', dataIndex: 'newValue' },
      ]}
    />
  )
}
