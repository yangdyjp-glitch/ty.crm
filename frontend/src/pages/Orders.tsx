import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
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
import type { TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import { ActionBtn, DeleteBtn } from '../components/Actions'
import { COL, scrollTableProps } from '../components/tableLayout'
import client from '../api/client'
import { apiErrorMessage } from '../api/errors'
import { useAuth } from '../auth/AuthContext'
import { loadProducts } from '../api/options'
import { CURRENCY_LABEL, ORDER_STATUS_LABEL, fmtDate, fmtMoney, todayDate } from '../api/types'
import { moneyIn } from '../api/money'

type MoneyValue = number | string | null | undefined

interface OrderCustomer {
  id: number
  name: string
  customerNo: string
  salesOwners?: NamedReference[]
}

interface NamedReference {
  id: number
  name: string
}

interface OrderRow {
  id: number
  orderNo: string
  signedAt?: string | null
  customer: OrderCustomer
  salesOwners?: NamedReference[]
  product?: NamedReference | null
  currency: string
  unitPrice?: MoneyValue
  originalPrice: MoneyValue
  quantity?: number | null
  discountAmount: MoneyValue
  receivableAmount: MoneyValue
  paidAmount: MoneyValue
  unpaidAmount: MoneyValue
  status: string
}

interface OrderListResponse {
  items: OrderRow[]
  total: number
}

interface CustomerListResponse {
  items: OrderCustomer[]
}

interface ProductOption extends NamedReference {
  standardPrice?: MoneyValue
  currency?: string | null
}

interface OrderFormValues {
  customerId: number
  productId: number
  signedAt?: string
  currency: string
  unitPrice: number
  quantity: number
  discountAmount?: number
  firstPaymentAmount: number
  firstPaymentPaidAt?: string
  tailPaymentAmount?: number
  remark?: string
  contractNo?: string
}

interface DeleteOrderErrorBody {
  message?: string | string[]
  blockingPayments?: string[]
  blockingRefunds?: string[]
}

const EMPTY_FILTER = '__EMPTY__'
const ORDER_STATUS_COLOR: Record<string, string> = {
  PENDING_PAYMENT: 'orange',
  PARTIAL_PAID: 'gold',
  FULLY_PAID: 'green',
  IN_SERVICE: 'green',
  COMPLETED: 'green',
  REFUNDED: 'red',
  CANCELLED: 'red',
}
const ORDER_COL = {
  no: COL.no,
  date: COL.date,
  person: COL.person,
  sales: COL.person,
  project: 170,
  currency: 64,
  money: 112,
  quantity: 72,
  status: 96,
  action: 180,
} as const

function filterValue(v: unknown) {
  return v == null || v === '' ? EMPTY_FILTER : String(v)
}

function filterText(v: unknown) {
  return v == null || v === '' ? '—' : String(v)
}

function uniqueFilters<Row>(
  rows: Row[],
  getValue: (row: Row) => unknown,
  getText: (row: Row) => unknown = getValue,
) {
  const seen = new Map<string, string>()
  rows.forEach((row) => {
    const value = filterValue(getValue(row))
    if (!seen.has(value)) seen.set(value, filterText(getText(row)))
  })
  return Array.from(seen.entries())
    .sort(([, a], [, b]) => a.localeCompare(b, 'zh-CN'))
    .map(([value, text]) => ({ value, text }))
}

function signedMonthValue(order: OrderRow) {
  return order.signedAt ? dayjs(order.signedAt).format('YYYY-MM') : EMPTY_FILTER
}

function monthFilters(rows: OrderRow[]) {
  const values = Array.from(new Set(rows.map(signedMonthValue)))
  return values
    .sort((a, b) => {
      if (a === EMPTY_FILTER) return 1
      if (b === EMPTY_FILTER) return -1
      return b.localeCompare(a)
    })
    .map((value) => ({ value, text: value === EMPTY_FILTER ? '未填写' : value }))
}

function orderQuantity(order: OrderRow) {
  return Number(order.quantity) || 1
}

function orderUnitPrice(order: OrderRow) {
  return order.unitPrice != null
    ? Number(order.unitPrice)
    : Number(order.originalPrice || 0) / orderQuantity(order)
}

function calcOriginalPrice(unitPrice: unknown, quantity: unknown) {
  return (Number(unitPrice) || 0) * (Number(quantity) || 1)
}

export default function Orders() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const nav = useNavigate()
  const [data, setData] = useState<OrderListResponse>({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<OrderFormValues>()
  const [customers, setCustomers] = useState<OrderCustomer[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const fp = Form.useWatch('firstPaymentAmount', form)
  const tp = Form.useWatch('tailPaymentAmount', form)
  const up = Form.useWatch('unitPrice', form)
  const qty = Form.useWatch('quantity', form)
  const dc = Form.useWatch('discountAmount', form)
  const selectedCustomerId = Form.useWatch('customerId', form)
  const originalPrice = calcOriginalPrice(up, qty)
  const receivable = originalPrice - (Number(dc) || 0)
  const paySum = (Number(fp) || 0) + (Number(tp) || 0)
  const payMismatch = originalPrice > 0 && paySum !== receivable

  const reload = () => {
    setLoading(true)
    setReloadKey((key) => key + 1)
  }

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    client
      .get<OrderListResponse>('/orders', {
        params: { all: 1 },
        noCache: true,
        signal: controller.signal,
      })
      .then((response) => {
        if (active) setData(response.data)
      })
      .catch((error: unknown) => {
        if (active) message.error(apiErrorMessage(error, '订单数据加载失败'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [reloadKey])

  const openCreate = async () => {
    form.resetFields()
    form.setFieldsValue({ currency: 'JPY', quantity: 1, signedAt: todayDate(), firstPaymentPaidAt: todayDate() })
    const cs = await client.get<CustomerListResponse>('/customers', { params: { all: 1 }, noCache: true })
    setCustomers(cs.data.items)
    setProducts(await loadProducts().catch(() => []))
    setOpen(true)
  }

  const applyProductDefaults = (productId: number) => {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    form.setFieldsValue({
      unitPrice: product.standardPrice != null ? Number(product.standardPrice) : undefined,
      currency: product.currency || form.getFieldValue('currency'),
    })
  }

  const submit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      await client.post('/orders', {
        ...v,
        quantity: Number(v.quantity) || 1,
        originalPrice: calcOriginalPrice(v.unitPrice, v.quantity),
      })
      message.success('已创建订单')
      setOpen(false)
      reload()
    } catch (error: unknown) {
      message.error(apiErrorMessage(error, '创建失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const act = async (id: number, action: string) => {
    await client.post(`/orders/${id}/${action}`)
    message.success('已更新')
    reload()
  }

  const doDelete = async (id: number) => {
    try {
      await client.delete(`/orders/${id}`)
      message.success('已删除订单')
      reload()
    } catch (error: unknown) {
      const detail = axios.isAxiosError<DeleteOrderErrorBody>(error)
        ? error.response?.data
        : undefined
      if (detail?.blockingPayments?.length || detail?.blockingRefunds?.length) {
        Modal.error({
          title: '无法删除订单',
          content: (
            <div>
              <p>{apiErrorMessage(error, '该订单存在关联财务记录')}</p>
              {!!detail.blockingPayments?.length && <p>已到账收款：{detail.blockingPayments.join('、')}</p>}
              {!!detail.blockingRefunds?.length && <p>已退款：{detail.blockingRefunds.join('、')}</p>}
            </div>
          ),
        })
      } else {
        message.error(apiErrorMessage(error, '删除失败'))
      }
    }
  }

  const signedMonthFilters = useMemo(() => monthFilters(data.items), [data.items])
  const productFilters = useMemo(
    () => uniqueFilters(data.items, (r) => r.product?.id, (r) => r.product?.name),
    [data.items],
  )
  const salesFilters = useMemo(
    () => uniqueFilters(data.items.flatMap((r) => r.salesOwners?.length ? r.salesOwners : [{ id: 0, name: '未分配' }]), (r) => r.id, (r) => r.name),
    [data.items],
  )
  const currencyFilters = useMemo(
    () => uniqueFilters(data.items, (r) => r.currency, (r) => CURRENCY_LABEL[r.currency] || r.currency),
    [data.items],
  )
  const statusFilters = useMemo(
    () => uniqueFilters(data.items, (r) => r.status, (r) => ORDER_STATUS_LABEL[r.status] || r.status),
    [data.items],
  )

  const columns: TableColumnsType<OrderRow> = [
    { title: '订单号', dataIndex: 'orderNo', width: ORDER_COL.no, render: (orderNo: string, order) => <a onClick={() => nav(`/orders/${order.id}`)}>{orderNo}</a> },
    {
      title: '时间',
      dataIndex: 'signedAt',
      width: ORDER_COL.date,
      filters: signedMonthFilters,
      onFilter: (value, order) => signedMonthValue(order) === value,
      render: fmtDate,
    },
    { title: '客户', width: ORDER_COL.person, render: (_value: unknown, order) => <a onClick={() => nav(`/customers/${order.customer.id}`)}>{order.customer.name}</a> },
    {
      title: '销售人员',
      width: ORDER_COL.sales,
      filters: salesFilters,
      filterSearch: true,
      onFilter: (value, order) => value === '0' ? !order.salesOwners?.length : !!order.salesOwners?.some((owner) => String(owner.id) === value),
      render: (_value: unknown, order) => order.salesOwners?.map((owner) => owner.name).join('、') || '未分配',
    },
    {
      title: '项目',
      width: ORDER_COL.project,
      filters: productFilters,
      filterSearch: true,
      onFilter: (value, order) => filterValue(order.product?.id) === value,
      render: (_value: unknown, order) => order.product?.name,
    },
    {
      title: '币种',
      dataIndex: 'currency',
      width: ORDER_COL.currency,
      filters: currencyFilters,
      onFilter: (value, order) => filterValue(order.currency) === value,
      render: (c: string) => CURRENCY_LABEL[c],
    },
    { title: '单价', dataIndex: 'unitPrice', width: ORDER_COL.money, render: (_value: unknown, order) => fmtMoney(orderUnitPrice(order)), align: 'right' },
    { title: '数量', dataIndex: 'quantity', width: ORDER_COL.quantity, render: (_value: unknown, order) => orderQuantity(order), align: 'right' },
    { title: '优惠', dataIndex: 'discountAmount', width: ORDER_COL.money, render: fmtMoney, align: 'right' as const },
    { title: '应收', dataIndex: 'receivableAmount', width: ORDER_COL.money, render: fmtMoney, align: 'right' as const },
    { title: '已收', dataIndex: 'paidAmount', width: ORDER_COL.money, render: moneyIn, align: 'right' as const },
    { title: '未收', dataIndex: 'unpaidAmount', width: ORDER_COL.money, render: fmtMoney, align: 'right' as const },
    {
      title: '确认状态',
      dataIndex: 'status',
      width: ORDER_COL.status,
      filters: statusFilters,
      onFilter: (value, order) => filterValue(order.status) === value,
      render: (s: string) => <Tag color={ORDER_STATUS_COLOR[s]}>{ORDER_STATUS_LABEL[s]}</Tag>,
    },
    {
      title: '操作',
      width: ORDER_COL.action,
      render: (_value: unknown, order) => (
        <Space wrap>
          <ActionBtn tone="view" onClick={() => nav(`/orders/${order.id}`)}>详情</ActionBtn>
          {['FULLY_PAID', 'PARTIAL_PAID', 'PENDING_PAYMENT'].includes(order.status) && (
            <ActionBtn tone="confirm" onClick={() => act(order.id, 'start-service')}>开始服务</ActionBtn>
          )}
          {order.status === 'IN_SERVICE' && (
            <ActionBtn tone="confirm" onClick={() => act(order.id, 'complete-service')}>完成服务</ActionBtn>
          )}
          {isAdmin && (
            <DeleteBtn
              onConfirm={() => doDelete(order.id)}
              title="确认删除该订单？未确认的收款及未执行的退款会一并删除；如存在已到账收款或已退款记录，系统将阻止删除。"
            />
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={openCreate}>签约（新建订单）</Button>
      <Table
        {...scrollTableProps}
        className="orders-list-table"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data.items}
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
          <Form.Item label="签约销售">
            {customers.find((customer) => customer.id === selectedCustomerId)?.salesOwners?.map((owner) => <Tag key={owner.id}>{owner.name}</Tag>) || '未分配'}
          </Form.Item>
          <Form.Item name="productId" label="项目" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              onChange={applyProductDefaults}
              options={products.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Form.Item>
          <Form.Item name="signedAt" label="签单时间">
            <Input type="date" />
          </Form.Item>
          <Space wrap>
            <Form.Item name="currency" label="币种" rules={[{ required: true }]}>
              <Select style={{ width: 100 }} options={[{ value: 'JPY', label: '日元' }, { value: 'CNY', label: '人民币' }]} />
            </Form.Item>
            <Form.Item name="unitPrice" label="单价" rules={[{ required: true }]}>
              <InputNumber min={0} controls={false} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="quantity" label="数量" rules={[{ required: true }]}>
              <InputNumber min={1} precision={0} controls={false} style={{ width: 90 }} />
            </Form.Item>
            <Form.Item label="应缴金额">
              <InputNumber value={originalPrice} disabled controls={false} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="discountAmount" label="优惠">
              <InputNumber min={0} controls={false} style={{ width: 100 }} />
            </Form.Item>
          </Space>
          <Form.Item name="firstPaymentAmount" label="首款金额（必填，待确认）" rules={[{ required: true }]}>
            <InputNumber min={0} controls={false} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="firstPaymentPaidAt" label="首款时间">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="tailPaymentAmount" label="尾款金额（选填，待确认）">
            <InputNumber min={0} controls={false} style={{ width: '100%' }} />
          </Form.Item>
          {payMismatch && (
            <div style={{ color: '#dc2626', marginBottom: 8 }}>
              提示：首款+尾款（{paySum.toLocaleString()}）≠ 应收（{receivable.toLocaleString()}），请在下方填写差异说明。
            </div>
          )}
          <Form.Item
            name="remark"
            label="说明（首款+尾款≠应收时必填）"
            rules={[
              {
                validator: (_, value) => {
                  const rcv = calcOriginalPrice(form.getFieldValue('unitPrice'), form.getFieldValue('quantity')) - (Number(form.getFieldValue('discountAmount')) || 0)
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
