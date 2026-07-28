import { useEffect, useState } from 'react'
import { Table, Tabs, Tag } from 'antd'
import dayjs from 'dayjs'
import client from '../api/client'
import { COL, pageTableProps } from '../components/tableLayout'

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
              {...pageTableProps}
              rowKey="id"
              loading={loading}
              dataSource={rows}
              columns={[
                { title: '时间', dataIndex: 'createdAt', width: COL.datetime, render: (t) => dayjs(t).format('YYYY-MM-DD HH:mm:ss') },
                { title: '操作人ID', dataIndex: 'operatorId', width: COL.no },
                { title: '对象', dataIndex: 'relatedType', width: COL.no, render: (t, r: Any) => `${t}#${r.relatedId ?? ''}` },
                { title: '动作', dataIndex: 'action', width: COL.method, render: (a) => <Tag>{ACTION_LABEL[a] || a}</Tag> },
                { title: '详情', dataIndex: 'newValue', width: COL.note },
              ]}
            />
          ),
        },
        {
          key: 'impersonation',
          label: '代理登录日志',
          children: (
            <Table
              {...pageTableProps}
              rowKey="id"
              loading={impLoading}
              dataSource={impRows}
              columns={[
                { title: '时间', dataIndex: 'createdAt', width: COL.datetime, render: (t) => dayjs(t).format('YYYY-MM-DD HH:mm:ss') },
                { title: '操作类型', dataIndex: 'action', width: COL.status, render: (a) => <Tag color={a === 'start' ? 'orange' : 'green'}>{a === 'start' ? '开始代理' : '退出代理'}</Tag> },
                { title: '管理员', width: COL.text, render: (_: any, r: Any) => `${r.actorName}（${r.actorUsername || r.actorId}）` },
                { title: '目标用户', width: COL.text, render: (_: any, r: Any) => `${r.targetName}（${r.targetUsername || r.targetUserId}）` },
              ]}
            />
          ),
        },
      ]}
    />
  )
}
