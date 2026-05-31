import { useEffect, useState } from 'react'
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Tag,
  message,
} from 'antd'
import dayjs from 'dayjs'
import client from '../api/client'
import { CURRENCY_LABEL, fmtMoney } from '../api/types'

type Any = Record<string, any>

const SERVICE_TYPES = ['住房', '电话卡', '保险', '其他']

export default function Referrals() {
  const [rows, setRows] = useState<Any[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const [customers, setCustomers] = useState<Any[]>([])

  const load = () => {
    setLoading(true)
    client.get('/referrals').then((r) => setRows(r.data)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openCreate = async () => {
    form.resetFields()
    const c = await client.get('/customers', { params: { pageSize: 100 } })
    setCustomers(c.data.items)
    setOpen(true)
  }
  const submit = async () => {
    const v = await form.validateFields()
    await client.post('/referrals', { ...v, settlementDate: v.settlementDate || undefined })
    message.success('已登记')
    setOpen(false)
    load()
  }
  const toggle = async (id: number, action: 'collect' | 'uncollect') => {
    await client.post(`/referrals/${id}/${action}`)
    load()
  }

  return (
    <div>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={openCreate}>登记转介绍收佣</Button>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '客户', render: (_, r) => r.customer?.name },
          { title: '服务种类', dataIndex: 'serviceType' },
          { title: '下游公司', dataIndex: 'downstreamCompany' },
          { title: '佣金', dataIndex: 'commissionAmount', render: fmtMoney, align: 'right' },
          { title: '币种', dataIndex: 'currency', render: (c) => CURRENCY_LABEL[c] },
          { title: '结款时间', dataIndex: 'settlementDate', render: (t) => (t ? dayjs(t).format('YYYY-MM-DD') : '—') },
          {
            title: '收款状态',
            dataIndex: 'collectionStatus',
            render: (s) => <Tag color={s === 'COLLECTED' ? 'green' : 'orange'}>{s === 'COLLECTED' ? '已收款' : '待收款'}</Tag>,
          },
          {
            title: '操作',
            render: (_, r) =>
              r.collectionStatus === 'PENDING' ? (
                <a onClick={() => toggle(r.id, 'collect')}>标记已收</a>
              ) : (
                <a onClick={() => toggle(r.id, 'uncollect')}>撤销</a>
              ),
          },
        ]}
      />
      <Modal title="登记转介绍收佣" open={open} onCancel={() => setOpen(false)} onOk={submit} destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ currency: 'JPY', serviceType: '住房' }}>
          <Form.Item name="customerId" label="客户（已分配给我的）" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={customers.map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
          <Form.Item name="serviceType" label="服务种类" rules={[{ required: true }]}>
            <Select options={SERVICE_TYPES.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item name="downstreamCompany" label="下游公司" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="commissionAmount" label="佣金额度" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="currency" label="币种" rules={[{ required: true }]}>
            <Select options={[{ value: 'JPY', label: '日元' }, { value: 'CNY', label: '人民币' }]} />
          </Form.Item>
          <Form.Item name="settlementDate" label="结款时间">
            <Input type="date" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
