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
  message,
} from 'antd'
import dayjs from 'dayjs'
import client from '../api/client'
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

type Any = Record<string, any>
const EMPTY_FILTER = '__EMPTY__'

function arrivalMonthValue(r: Any) {
  return r.completedAt ? dayjs(r.completedAt).format('YYYY-MM') : EMPTY_FILTER
}

function monthFilters(rows: Any[]) {
  const values = Array.from(new Set(rows.map(arrivalMonthValue)))
  return values
    .sort((a, b) => {
      if (a === EMPTY_FILTER) return 1
      if (b === EMPTY_FILTER) return -1
      return b.localeCompare(a)
    })
    .map((value) => ({ value, text: value === EMPTY_FILTER ? '未到账' : value }))
}

export default function Refunds() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const nav = useNavigate()
  const [rows, setRows] = useState<Any[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()
  const [orders, setOrders] = useState<Any[]>([])

  const load = () => {
    setLoading(true)
    client.get('/refunds').then((r) => setRows(r.data)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openCreate = async () => {
    form.resetFields()
    form.setFieldsValue({ bearer: 'COMPANY', refundPercent: 100, appliedAt: todayDate() })
    const o = await client.get('/orders', { params: { all: 1 } })
    setOrders(o.data.items.filter((x: Any) => !['REFUNDED', 'CANCELLED'].includes(x.status)))
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
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const act = async (id: number, action: 'approve' | 'reject' | 'pay') => {
    await client.post(`/refunds/${id}/${action}`)
    message.success(action === 'approve' ? '已审核' : action === 'pay' ? '已支付退款' : '已拒绝')
    load()
  }

  const doRemove = async (id: number) => {
    try {
      await client.delete(`/refunds/${id}`)
      message.success('已删除')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '删除失败')
    }
  }

  const arrivalMonthFilters = useMemo(() => monthFilters(rows), [rows])

  return (
    <div>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={openCreate}>发起退款</Button>
      <Table
        {...scrollTableProps}
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '退款号', dataIndex: 'refundNo', width: COL.no },
          { title: '登记时间', dataIndex: 'appliedAt', width: COL.date, render: (t: string, r: Any) => fmtDate(t ?? r.createdAt) },
          {
            title: '到账时间',
            dataIndex: 'completedAt',
            width: COL.date,
            filters: arrivalMonthFilters,
            onFilter: (value: any, r) => arrivalMonthValue(r) === value,
            render: fmtDate,
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
                {isAdmin && (
                  <DeleteBtn
                    title={r.status === 'REFUNDED' ? '该退款已执行，删除会回退订单退款额（佣金/台账请人工复核）。确定删除？' : '确认删除该退款记录？'}
                    onConfirm={() => doRemove(r.id)}
                  />
                )}
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
