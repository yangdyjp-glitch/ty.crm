import { useEffect, useState } from 'react'
import { Table, Tabs, Tag } from 'antd'
import dayjs from 'dayjs'
import client from '../api/client'

type Any = Record<string, any>

const ACTION_LABEL: Record<string, string> = {
  APPROVE_REFUND: '执行退款',
  PAY_COMMISSION: '支付分成',
}

export default function AuditLogs() {
  const [rows, setRows] = useState<Any[]>([])
  const [impRows, setImpRows] = useState<Any[]>([])
  const [loading, setLoading] = useState(false)
  const [impLoading, setImpLoading] = useState(false)
  useEffect(() => {
    setLoading(true)
    client.get('/audit-logs').then((r) => setRows(r.data)).finally(() => setLoading(false))
    setImpLoading(true)
    client.get('/auth/impersonation-logs').then((r) => setImpRows(r.data)).finally(() => setImpLoading(false))
  }, [])

  return (
    <Tabs
      items={[
        {
          key: 'audit',
          label: '操作日志',
          children: (
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
          ),
        },
        {
          key: 'impersonation',
          label: '代理登录日志',
          children: (
            <Table
              rowKey="id"
              loading={impLoading}
              dataSource={impRows}
              columns={[
                { title: '时间', dataIndex: 'createdAt', render: (t) => dayjs(t).format('YYYY-MM-DD HH:mm:ss') },
                { title: '操作类型', dataIndex: 'action', render: (a) => <Tag color={a === 'start' ? 'orange' : 'green'}>{a === 'start' ? '开始代理' : '退出代理'}</Tag> },
                { title: '管理员', render: (_: any, r: Any) => `${r.actorName}（${r.actorUsername || r.actorId}）` },
                { title: '目标用户', render: (_: any, r: Any) => `${r.targetName}（${r.targetUsername || r.targetUserId}）` },
              ]}
            />
          ),
        },
      ]}
    />
  )
}
