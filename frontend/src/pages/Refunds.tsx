import { useEffect, useState } from 'react'
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd'
import client from '../api/client'
import { useAuth } from '../auth/AuthContext'
import {
  REFUND_BEARER_LABEL,
  REFUND_REASON_LABEL,
  REFUND_STATUS_LABEL,
  fmtMoney,
} from '../api/types'
import { moneyOut } from '../api/money'

type Any = Record<string, any>

export default function Refunds() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [rows, setRows] = useState<Any[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const [orders, setOrders] = useState<Any[]>([])

  const load = () => {
    setLoading(true)
    client.get('/refunds').then((r) => setRows(r.data)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openCreate = async () => {
    form.resetFields()
    const o = await client.get('/orders', { params: { pageSize: 100 } })
    setOrders(o.data.items.filter((x: Any) => !['REFUNDED', 'CANCELLED'].includes(x.status)))
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    await client.post('/refunds', {
      orderId: v.orderId,
      refundRatio: v.refundPercent / 100,
      reason: v.reason,
      reasonNote: v.reasonNote,
      bearer: v.bearer,
    })
    message.success('已提交退款申请（待管理员执行）')
    setOpen(false)
    load()
  }

  const act = async (id: number, action: 'approve' | 'reject') => {
    await client.post(`/refunds/${id}/${action}`)
    message.success(action === 'approve' ? '已执行退款' : '已拒绝')
    load()
  }

  return (
    <div>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={openCreate}>发起退款</Button>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '退款号', dataIndex: 'refundNo', width: 130 },
          { title: '客户', render: (_, r) => r.customer?.name },
          { title: '订单', render: (_, r) => r.order?.orderNo },
          { title: '名义额', dataIndex: 'nominalAmount', render: moneyOut, align: 'right' },
          { title: '实退现金', dataIndex: 'cashAmount', render: moneyOut, align: 'right' },
          { title: '抵减', dataIndex: 'offsetAmount', render: moneyOut, align: 'right' },
          { title: '原因', dataIndex: 'reason', render: (r) => REFUND_REASON_LABEL[r] },
          { title: '承担方', dataIndex: 'bearer', render: (b) => REFUND_BEARER_LABEL[b] },
          {
            title: '状态',
            dataIndex: 'status',
            render: (s) => <Tag color={s === 'REFUNDED' ? 'green' : s === 'REJECTED' ? 'red' : 'orange'}>{REFUND_STATUS_LABEL[s]}</Tag>,
          },
          {
            title: '操作',
            render: (_, r) =>
              isAdmin && r.status === 'PENDING' ? (
                <Space>
                  <a onClick={() => act(r.id, 'approve')}>执行</a>
                  <a style={{ color: '#cf1322' }} onClick={() => act(r.id, 'reject')}>拒绝</a>
                </Space>
              ) : null,
          },
        ]}
      />
      <Modal title="发起退款" open={open} onCancel={() => setOpen(false)} onOk={submit} destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ bearer: 'COMPANY', refundPercent: 100 }}>
          <Form.Item name="orderId" label="订单" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={orders.map((o) => ({ value: o.id, label: `${o.orderNo} ${o.customer?.name || ''} 应收${fmtMoney(o.receivableAmount)}` }))}
            />
          </Form.Item>
          <Form.Item name="refundPercent" label="退款比例 %（基于合同）" rules={[{ required: true }]}>
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="退款原因" rules={[{ required: true }]}>
            <Select options={Object.entries(REFUND_REASON_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          <Form.Item name="bearer" label="退款承担方">
            <Select options={Object.entries(REFUND_BEARER_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          <Form.Item name="reasonNote" label="说明"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
