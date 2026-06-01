import { useEffect, useState } from 'react'
import {
  Button,
  Form,
  InputNumber,
  Modal,
  Select,
  Table,
  Tag,
  message,
} from 'antd'
import client from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { CURRENCY_LABEL, PAYMENT_CONFIRM_LABEL, fmtMoney } from '../api/types'
import { moneyIn } from '../api/money'

type Any = Record<string, any>

export default function Payments() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [rows, setRows] = useState<Any[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()
  const [orders, setOrders] = useState<Any[]>([])

  const load = () => {
    setLoading(true)
    client.get('/payments').then((r) => setRows(r.data)).finally(() => setLoading(false))
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
    setSubmitting(true)
    try {
      await client.post('/payments', v)
      message.success('已录入收款（待管理员确认）')
      setOpen(false)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const confirm = async (id: number) => {
    await client.post(`/payments/${id}/confirm`)
    message.success('已确认到账')
    load()
  }

  return (
    <div>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={openCreate}>录入收款</Button>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '收款号', dataIndex: 'paymentNo', width: 130 },
          { title: '客户', render: (_, r) => r.customer?.name },
          { title: '订单', render: (_, r) => r.order?.orderNo },
          { title: '金额', dataIndex: 'amount', render: moneyIn, align: 'right' },
          { title: '币种', dataIndex: 'currency', render: (c) => CURRENCY_LABEL[c] },
          {
            title: '确认状态',
            dataIndex: 'confirmStatus',
            render: (s) => <Tag color={s === 'CONFIRMED' ? 'green' : s === 'PROBLEM' ? 'red' : 'orange'}>{PAYMENT_CONFIRM_LABEL[s]}</Tag>,
          },
          {
            title: '操作',
            render: (_, r) =>
              isAdmin && r.confirmStatus === 'PENDING' ? <a onClick={() => confirm(r.id)}>确认到账</a> : null,
          },
        ]}
      />
      <Modal title="录入收款" open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={submitting} okText={submitting ? '处理中…' : '确定'} maskClosable={false} cancelButtonProps={{ disabled: submitting }} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="orderId" label="订单" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={orders.map((o) => ({ value: o.id, label: `${o.orderNo} ${o.customer?.name || ''} 未收${fmtMoney(o.unpaidAmount)}` }))}
            />
          </Form.Item>
          <Form.Item name="amount" label="收款金额" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
