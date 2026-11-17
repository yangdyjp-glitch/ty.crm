import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  Tooltip,
  message,
} from 'antd'
import dayjs from 'dayjs'
import client from '../api/client'
import { apiErrorMessage } from '../api/errors'
import { ActionBtn, DeleteBtn } from '../components/Actions'
import { COL, scrollTableProps } from '../components/tableLayout'
import { useAuth } from '../auth/AuthContext'
import {
  REFUND_BEARER_LABEL,
  REFUND_REASON_LABEL,
  REFUND_STATUS_LABEL,
  fmtDate,
  fmtMoney,
  todayDate,
} from '../api/types'
import { moneyOut } from '../api/money'

type RefundRow = {
  id: number
  refundNo: string
  appliedAt?: string | null
  createdAt: string
  completedAt?: string | null
  customer?: { id: number; name: string } | null
  nominalAmount: number | string
  cashAmount: number | string
  offsetAmount: number | string
  reason: string
  bearer: string
  status: string
}

type OrderOption = {
  id: number
  orderNo: string
  status: string
  receivableAmount: number | string
  customer?: { name: string } | null
}

type RefundForm = {
  orderId: number
  refundPercent: number
  reason: string
  reasonNote?: string
  bearer: string
  appliedAt?: string
}

const EMPTY_FILTER = '__EMPTY__'

function arrivalMonthValue(r: RefundRow) {
  if (r.status !== 'REFUNDED') return EMPTY_FILTER
  return r.completedAt ? dayjs(r.completedAt).format('YYYY-MM') : '__REFUNDED_WITHOUT_DATE__'
}

function monthFilters(rows: RefundRow[]) {
  const values = Array.from(new Set(rows.map(arrivalMonthValue)))
  return values
    .sort((a, b) => {
      if (a === EMPTY_FILTER) return 1
      if (b === EMPTY_FILTER) return -1
      return b.localeCompare(a)
    })
    .map((value) => ({ value, text: value === EMPTY_FILTER ? '未完成退款' : value === '__REFUNDED_WITHOUT_DATE__' ? '已退款（日期未填）' : value }))
}

const fetchRefunds = (signal?: AbortSignal) => client.get<RefundRow[]>('/refunds', { signal })

export default function Refunds() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const nav = useNavigate()
  const [rows, setRows] = useState<RefundRow[]>([])
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<RefundForm>()
  const [orders, setOrders] = useState<OrderOption[]>([])

  const reload = () => {
    setLoading(true)
    setReloadKey((current) => current + 1)
  }
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    void fetchRefunds(controller.signal)
      .then((response) => { if (active) setRows(response.data) })
      .catch((error: unknown) => { if (active) message.error(apiErrorMessage(error, '退款数据加载失败')) })
      .finally(() => { if (active) setLoading(false) })
    return () => {
      active = false
      controller.abort()
    }
  }, [reloadKey])

  const openCreate = async () => {
    form.resetFields()
    form.setFieldsValue({ bearer: 'COMPANY', refundPercent: 100, appliedAt: todayDate() })
    const o = await client.get<{ items: OrderOption[] }>('/orders', { params: { all: 1 } })
    setOrders(o.data.items.filter((order) => !['REFUNDED', 'CANCELLED'].includes(order.status)))
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      await client.post('/refunds', {
        orderId: v.orderId,
        refundRatio: v.refundPercent / 100,
        reason: v.reason,
        reasonNote: v.reasonNote,
        bearer: v.bearer,
        appliedAt: v.appliedAt,
      })
      message.success('已提交退款申请（待管理员执行）')
      setOpen(false)
      reload()
    } catch (error: unknown) {
      message.error(apiErrorMessage(error, '操作失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const act = async (id: number, action: 'approve' | 'reject' | 'pay') => {
    await client.post(`/refunds/${id}/${action}`)
    message.success(action === 'approve' ? '已审核' : action === 'pay' ? '已支付退款' : '已拒绝')
    reload()
  }

  const doRemove = async (id: number) => {
    try {
      await client.delete(`/refunds/${id}`)
      message.success('已删除')
      reload()
    } catch (error: unknown) {
      message.error(apiErrorMessage(error, '删除失败'))
    }
  }

  const arrivalMonthFilters = useMemo(() => monthFilters(rows), [rows])

  return (
    <div>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={openCreate}>发起退款</Button>
      <Table<RefundRow>
        {...scrollTableProps}
        className="refunds-list-table full-height-list-table"
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '退款号', dataIndex: 'refundNo', width: COL.no },
          { title: '登记时间', dataIndex: 'appliedAt', width: COL.date, render: (t: string | null, r) => fmtDate(t ?? r.createdAt) },
          {
            title: '退款完成时间',
            dataIndex: 'completedAt',
            width: COL.date,
            filters: arrivalMonthFilters,
            onFilter: (value, r) => arrivalMonthValue(r) === String(value),
            render: (t: string | null, r: RefundRow) => r.status === 'REFUNDED' ? (t ? fmtDate(t) : '日期未填') : '—',
          },
          { title: '客户', width: COL.person, render: (_, r) => <a onClick={() => nav(`/customers/${r.customer?.id}`)}>{r.customer?.name}</a> },
          { title: '名义额', dataIndex: 'nominalAmount', width: COL.money, render: moneyOut, align: 'right' },
          { title: '实退现金', dataIndex: 'cashAmount', width: COL.money, render: moneyOut, align: 'right' },
          { title: '抵减', dataIndex: 'offsetAmount', width: COL.money, render: moneyOut, align: 'right' },
          { title: '原因', dataIndex: 'reason', width: COL.type, render: (r) => REFUND_REASON_LABEL[r] },
          { title: '承担方', dataIndex: 'bearer', width: COL.type, render: (b) => REFUND_BEARER_LABEL[b] },
          {
            title: '状态',
            dataIndex: 'status',
            width: COL.status,
            render: (s) => <Tag color={s === 'REFUNDED' ? 'green' : s === 'REJECTED' ? 'red' : s === 'APPROVED' ? 'gold' : 'orange'}>{REFUND_STATUS_LABEL[s]}</Tag>,
          },
          {
            title: '操作',
            width: COL.actionWide,
            render: (_, r) => (
              <Space wrap>
                {isAdmin && r.status === 'PENDING' && (
                  <>
                    <ActionBtn tone="confirm" onClick={() => act(r.id, 'approve')}>审核</ActionBtn>
                    <ActionBtn tone="reject" onClick={() => act(r.id, 'reject')}>拒绝</ActionBtn>
                  </>
                )}
                {isAdmin && r.status === 'APPROVED' && (
                  <Popconfirm title="确认支付退款？将终止订单并按比例追回佣金" okText="支付" cancelText="取消" onConfirm={() => act(r.id, 'pay')}>
                    <ActionBtn tone="confirm">支付</ActionBtn>
                  </Popconfirm>
                )}
                {isAdmin && (r.status === 'REFUNDED' ? (
                  <Tooltip title="该退款已执行，为保留财务审计链，不允许删除">
                    <span>
                      <DeleteBtn disabled onConfirm={() => doRemove(r.id)}>不可删除</DeleteBtn>
                    </span>
                  </Tooltip>
                ) : (
                  <DeleteBtn title="确认删除该退款记录？" onConfirm={() => doRemove(r.id)} />
                ))}
              </Space>
            ),
          },
        ]}
      />
      <Modal title="发起退款" open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={submitting} okText={submitting ? '处理中…' : '确定'} maskClosable={false} cancelButtonProps={{ disabled: submitting }} destroyOnClose>
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
          <Form.Item name="appliedAt" label="登记时间">
            <Input type="date" />
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
