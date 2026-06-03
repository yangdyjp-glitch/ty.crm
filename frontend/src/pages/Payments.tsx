import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { ActionBtn, DeleteBtn } from '../components/Actions'
import client from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { CURRENCY_LABEL, PAYMENT_CONFIRM_LABEL, fmtMoney } from '../api/types'
import { moneyIn } from '../api/money'

type Any = Record<string, any>

export default function Payments() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const nav = useNavigate()
  const [rows, setRows] = useState<Any[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()
  const [orders, setOrders] = useState<Any[]>([])
  const [editTarget, setEditTarget] = useState<Any | null>(null)
  const [editForm] = Form.useForm()

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

  const openEdit = (r: Any) => {
    setEditTarget(r)
    editForm.setFieldsValue({ amount: Number(r.amount), method: r.method, remark: r.remark })
  }
  const submitEdit = async () => {
    const v = await editForm.validateFields()
    setSubmitting(true)
    try {
      await client.patch(`/payments/${editTarget!.id}`, v)
      message.success('已修改')
      setEditTarget(null)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '操作失败')
    } finally {
      setSubmitting(false)
    }
  }
  const doDelete = async (id: number) => {
    try {
      await client.delete(`/payments/${id}`)
      message.success('已删除')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '删除失败')
    }
  }

  return (
    <div>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={openCreate}>录入收款</Button>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '收款号', dataIndex: 'paymentNo' },
          { title: '客户', render: (_, r) => <a onClick={() => nav(`/customers/${r.customer?.id}`)}>{r.customer?.name}</a> },
          { title: '订单', render: (_, r) => <a onClick={() => nav(`/orders/${r.order?.id}`)}>{r.order?.orderNo}</a> },
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
              r.confirmStatus === 'CONFIRMED' ? (
                <Space wrap>
                  <DeleteBtn onConfirm={() => doDelete(r.id)} title="该收款已到账，删除会回退订单的已收金额。确定删除？" />
                </Space>
              ) : (
                <Space wrap>
                  {isAdmin && <ActionBtn tone="confirm" onClick={() => confirm(r.id)}>确认到账</ActionBtn>}
                  <ActionBtn tone="edit" onClick={() => openEdit(r)}>修改</ActionBtn>
                  <DeleteBtn onConfirm={() => doDelete(r.id)} title="确认删除这条收款？" />
                </Space>
              ),
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

      <Modal title="修改收款（仅待确认可改）" open={!!editTarget} onCancel={() => setEditTarget(null)} onOk={submitEdit} confirmLoading={submitting} okText={submitting ? '处理中…' : '确定'} maskClosable={false} cancelButtonProps={{ disabled: submitting }} destroyOnClose>
        {editTarget && (
          <Form form={editForm} layout="vertical">
            <div style={{ marginBottom: 12, color: '#6b7280', fontSize: 13 }}>
              订单 {editTarget.order?.orderNo}　应收 {fmtMoney(editTarget.order?.receivableAmount)} / 已收 {fmtMoney(editTarget.order?.paidAmount)} / 未收 {fmtMoney(editTarget.order?.unpaidAmount)}
            </div>
            <Form.Item name="amount" label="收款金额" rules={[{ required: true }]}>
              <InputNumber min={0} controls={false} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="method" label="收款方式"><Input /></Form.Item>
            <Form.Item
              name="remark"
              label="备注 / 差异说明"
              rules={[
                {
                  validator: (_, value) => {
                    const amt = Number(editForm.getFieldValue('amount'))
                    const unpaid = Number(editTarget.order?.unpaidAmount ?? 0)
                    if (amt !== unpaid && !value) {
                      return Promise.reject(new Error('实收与应收余额不一致，请填写差异说明'))
                    }
                    return Promise.resolve()
                  },
                },
              ]}
            >
              <Input.TextArea rows={2} placeholder="若实收与应收余额不一致，请说明原因" />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  )
}
