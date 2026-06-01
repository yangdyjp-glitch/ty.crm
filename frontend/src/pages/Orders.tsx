import { useEffect, useState } from 'react'
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd'
import client from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { loadProducts } from '../api/options'
import { CURRENCY_LABEL, ORDER_STATUS_LABEL, fmtMoney } from '../api/types'
import { moneyIn } from '../api/money'

type Any = Record<string, any>

export default function Orders() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [data, setData] = useState<{ items: Any[]; total: number }>({ items: [], total: 0 })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()
  const [customers, setCustomers] = useState<Any[]>([])
  const [products, setProducts] = useState<Any[]>([])

  const load = () => {
    setLoading(true)
    client.get('/orders', { params: { page, pageSize } }).then((r) => setData(r.data)).finally(() => setLoading(false))
  }
  useEffect(load, [page, pageSize])

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
    { title: '订单号', dataIndex: 'orderNo', width: 130 },
    { title: '客户', render: (_: any, r: Any) => r.customer?.name },
    { title: '项目', render: (_: any, r: Any) => r.product?.name },
    { title: '币种', dataIndex: 'currency', render: (c: string) => CURRENCY_LABEL[c] },
    { title: '应收', dataIndex: 'receivableAmount', render: fmtMoney, align: 'right' as const },
    { title: '已收', dataIndex: 'paidAmount', render: moneyIn, align: 'right' as const },
    { title: '未收', dataIndex: 'unpaidAmount', render: fmtMoney, align: 'right' as const },
    { title: '状态', dataIndex: 'status', render: (s: string) => <Tag>{ORDER_STATUS_LABEL[s]}</Tag> },
    {
      title: '操作',
      render: (_: any, r: Any) => (
        <Space>
          {['FULLY_PAID', 'PARTIAL_PAID', 'PENDING_PAYMENT'].includes(r.status) && (
            <a onClick={() => act(r.id, 'start-service')}>开始服务</a>
          )}
          {['IN_SERVICE', 'FULLY_PAID', 'PARTIAL_PAID'].includes(r.status) && (
            <a onClick={() => act(r.id, 'complete-service')}>完成服务</a>
          )}
          {isAdmin && (
            <Popconfirm title="确认删除该订单？其收款/退款将一并删除" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => doDelete(r.id)}>
              <a style={{ color: '#dc2626' }}>删除</a>
            </Popconfirm>
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
        pagination={{ current: page, pageSize, total: data.total, onChange: (p, ps) => { setPage(p); setPageSize(ps) }, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }}
      />
      <Modal title="签约 + 首款" open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={submitting} okText={submitting ? '处理中…' : '确定'} maskClosable={false} cancelButtonProps={{ disabled: submitting }} destroyOnClose>
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
          <Form.Item name="firstPaymentAmount" label="首款金额（可选，待管理员确认）">
            <InputNumber min={0} controls={false} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="contractNo" label="合同编号"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
