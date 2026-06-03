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
import { loadProducts } from '../api/options'
import { CURRENCY_LABEL, ORDER_STATUS_LABEL, fmtMoney } from '../api/types'
import { moneyIn } from '../api/money'

type Any = Record<string, any>

export default function Orders() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const nav = useNavigate()
  const [data, setData] = useState<{ items: Any[]; total: number }>({ items: [], total: 0 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()
  const [customers, setCustomers] = useState<Any[]>([])
  const [products, setProducts] = useState<Any[]>([])
  const fp = Form.useWatch('firstPaymentAmount', form)
  const tp = Form.useWatch('tailPaymentAmount', form)
  const op = Form.useWatch('originalPrice', form)
  const dc = Form.useWatch('discountAmount', form)
  const receivable = (Number(op) || 0) - (Number(dc) || 0)
  const paySum = (Number(fp) || 0) + (Number(tp) || 0)
  const payMismatch = !!op && paySum !== receivable

  const load = () => {
    setLoading(true)
    client.get('/orders', { params: { page, pageSize: 12 } }).then((r) => setData(r.data)).finally(() => setLoading(false))
  }
  useEffect(load, [page])

  const openCreate = async () => {
    form.resetFields()
    const cs = await client.get('/customers', { params: { pageSize: 100 } })
    setCustomers(cs.data.items)
    setProducts(await loadProducts().catch(() => []))
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      await client.post('/orders', v)
      message.success('已创建订单')
      setOpen(false)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const act = async (id: number, action: string) => {
    await client.post(`/orders/${id}/${action}`)
    message.success('已更新')
    load()
  }

  const doDelete = async (id: number) => {
    try {
      await client.delete(`/orders/${id}`)
      message.success('已删除订单')
      load()
    } catch (e: any) {
      const d = e.response?.data
      if (d?.blockingPayments?.length || d?.blockingRefunds?.length) {
        Modal.error({
          title: '无法删除订单',
          content: (
            <div>
              <p>{d.message}</p>
              {d.blockingPayments?.length > 0 && <p>已到账收款：{d.blockingPayments.join('、')}</p>}
              {d.blockingRefunds?.length > 0 && <p>已退款：{d.blockingRefunds.join('、')}</p>}
            </div>
          ),
        })
      } else {
        message.error(d?.message || '删除失败')
      }
    }
  }

  const columns = [
    { title: '订单号', dataIndex: 'orderNo', width: 130, render: (n: string, r: Any) => <a onClick={() => nav(`/orders/${r.id}`)}>{n}</a> },
    { title: '客户', width: 130, render: (_: any, r: Any) => <a onClick={() => nav(`/customers/${r.customer?.id}`)}>{r.customer?.name}</a> },
    { title: '项目', width: 140, render: (_: any, r: Any) => r.product?.name },
    { title: '币种', dataIndex: 'currency', width: 70, render: (c: string) => CURRENCY_LABEL[c] },
    { title: '应收', dataIndex: 'receivableAmount', width: 120, render: fmtMoney, align: 'right' as const },
    { title: '已收', dataIndex: 'paidAmount', width: 120, render: moneyIn, align: 'right' as const },
    { title: '未收', dataIndex: 'unpaidAmount', width: 120, render: fmtMoney, align: 'right' as const },
    { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => <Tag>{ORDER_STATUS_LABEL[s]}</Tag> },
    {
      title: '操作',
      width: 280,
      render: (_: any, r: Any) => (
        <Space wrap>
          <ActionBtn tone="view" onClick={() => nav(`/orders/${r.id}`)}>详情</ActionBtn>
          {['FULLY_PAID', 'PARTIAL_PAID', 'PENDING_PAYMENT'].includes(r.status) && (
            <ActionBtn tone="confirm" onClick={() => act(r.id, 'start-service')}>开始服务</ActionBtn>
          )}
          {['IN_SERVICE', 'FULLY_PAID', 'PARTIAL_PAID'].includes(r.status) && (
            <ActionBtn tone="confirm" onClick={() => act(r.id, 'complete-service')}>完成服务</ActionBtn>
          )}
          {isAdmin && (
            <DeleteBtn onConfirm={() => doDelete(r.id)} title="确认删除该订单？其收款/退款将一并删除" />
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={openCreate}>签约（新建订单）</Button>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data.items}
        pagination={{ current: page, pageSize: 12, total: data.total, onChange: setPage, showSizeChanger: false }}
      />
      <Modal title="签约（首款必填 / 尾款选填）" open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={submitting} okText={submitting ? '处理中…' : '确定'} maskClosable={false} cancelButtonProps={{ disabled: submitting }} destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ currency: 'JPY' }}>
          <Form.Item name="customerId" label="客户" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={customers.map((c) => ({ value: c.id, label: `${c.name}（${c.customerNo}）` }))}
            />
          </Form.Item>
          <Form.Item name="productId" label="项目" rules={[{ required: true }]}>
            <Select options={products.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Space>
            <Form.Item name="currency" label="币种" rules={[{ required: true }]}>
              <Select style={{ width: 100 }} options={[{ value: 'JPY', label: '日元' }, { value: 'CNY', label: '人民币' }]} />
            </Form.Item>
            <Form.Item name="originalPrice" label="应缴金额" rules={[{ required: true }]}>
              <InputNumber min={0} controls={false} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="discountAmount" label="优惠">
              <InputNumber min={0} controls={false} style={{ width: 100 }} />
            </Form.Item>
          </Space>
          <Form.Item name="firstPaymentAmount" label="首款金额（必填，待确认）" rules={[{ required: true }]}>
            <InputNumber min={0} controls={false} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="tailPaymentAmount" label="尾款金额（选填，待确认）">
            <InputNumber min={0} controls={false} style={{ width: '100%' }} />
          </Form.Item>
          {payMismatch && (
            <div style={{ color: '#dc2626', marginBottom: 8 }}>
              ⚠️ 首款+尾款（{paySum.toLocaleString()}）≠ 应收（{receivable.toLocaleString()}），请在下方填写差异说明。
            </div>
          )}
          <Form.Item
            name="remark"
            label="说明（首款+尾款≠应收时必填）"
            rules={[
              {
                validator: (_, value) => {
                  const rcv = (Number(form.getFieldValue('originalPrice')) || 0) - (Number(form.getFieldValue('discountAmount')) || 0)
                  const sum = (Number(form.getFieldValue('firstPaymentAmount')) || 0) + (Number(form.getFieldValue('tailPaymentAmount')) || 0)
                  if (sum !== rcv && !value) return Promise.reject(new Error('首款+尾款与应收不一致，请填写差异说明'))
                  return Promise.resolve()
                },
              },
            ]}
          >
            <Input.TextArea rows={2} placeholder="如：分期收款、尾款待定、优惠后差额等" />
          </Form.Item>
          <Form.Item name="contractNo" label="合同编号"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
