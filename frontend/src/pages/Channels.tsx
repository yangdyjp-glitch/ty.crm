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
import dayjs from 'dayjs'
import client from '../api/client'
import { useAuth } from '../auth/AuthContext'
import {
  CHANNEL_TYPE_LABEL,
  COMMISSION_METHOD_LABEL,
  FUND_MODE_LABEL,
  LEDGER_TYPE_LABEL,
  SETTLEMENT_COND_LABEL,
} from '../api/types'

type Any = Record<string, any>

export default function Channels() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [rows, setRows] = useState<Any[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Any | null>(null)
  const [form] = Form.useForm()
  const [ledger, setLedger] = useState<Any | null>(null)
  const openLedger = async (id: number) => {
    const { data } = await client.get(`/channels/${id}/ledger`)
    setLedger(data)
  }

  const load = () => {
    setLoading(true)
    client.get('/channels').then((r) => setRows(r.data)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openForm = (rec?: Any) => {
    setEditing(rec || null)
    form.resetFields()
    if (rec) form.setFieldsValue(rec)
    else form.setFieldsValue({ channelType: isAdmin ? 'ENTERPRISE' : 'INDIVIDUAL', commissionMethod: 'NET_RECEIVED_RATIO', fundSettlementMode: 'COMPANY_REBATE', settlementCondition: 'ON_SERVICE_COMPLETE' })
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    if (editing) await client.patch(`/channels/${editing.id}`, v)
    else await client.post('/channels', v)
    message.success('已保存')
    setOpen(false)
    load()
  }

  return (
    <div>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={() => openForm()}>
        {isAdmin ? '新增渠道' : '新增个人渠道'}
      </Button>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '编号', dataIndex: 'channelNo', width: 110 },
          { title: '名称', dataIndex: 'name' },
          { title: '类型', dataIndex: 'channelType', render: (t) => <Tag>{CHANNEL_TYPE_LABEL[t]}</Tag> },
          { title: '默认比例', dataIndex: 'defaultCommissionRate', render: (r) => (r != null ? r + '%' : '—') },
          { title: '计算方式', dataIndex: 'commissionMethod', render: (m) => COMMISSION_METHOD_LABEL[m] },
          { title: '资金模式', dataIndex: 'fundSettlementMode', render: (m) => FUND_MODE_LABEL[m] },
          { title: '结算条件', dataIndex: 'settlementCondition', render: (s) => SETTLEMENT_COND_LABEL[s] },
          {
            title: '操作',
            render: (_, r) =>
              isAdmin ? (
                <Space>
                  <a onClick={() => openForm(r)}>编辑</a>
                  <a onClick={() => openLedger(r.id)}>台账</a>
                </Space>
              ) : null,
          },
        ]}
      />

      <Modal title="往来 / 抵扣台账（按币种）" open={!!ledger} onCancel={() => setLedger(null)} footer={null} width={760}>
        {ledger && (
          <>
            <div style={{ marginBottom: 12 }}>
              当前余额（正=第三方欠公司，负=公司欠第三方）： CNY <b>{ledger.balances.CNY}</b> ， JPY <b>{ledger.balances.JPY}</b>
            </div>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={ledger.entries}
              columns={[
                { title: '时间', dataIndex: 'createdAt', render: (t: string) => dayjs(t).format('MM-DD HH:mm') },
                { title: '币种', dataIndex: 'currency' },
                { title: '类型', dataIndex: 'entryType', render: (e: string) => LEDGER_TYPE_LABEL[e] || e },
                { title: '金额', dataIndex: 'amount', align: 'right' },
                { title: '余额', dataIndex: 'balanceAfter', align: 'right' },
                { title: '说明', dataIndex: 'note' },
              ]}
            />
          </>
        )}
      </Modal>
      <Modal title={editing ? '编辑渠道' : '新增渠道'} open={open} onCancel={() => setOpen(false)} onOk={submit} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="渠道名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="channelType" label="类型" rules={[{ required: true }]}>
            <Select disabled={!isAdmin} options={Object.entries(CHANNEL_TYPE_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          <Space>
            <Form.Item name="defaultCommissionRate" label="默认分成比例 %">
              <InputNumber min={0} max={100} />
            </Form.Item>
            <Form.Item name="commissionMethod" label="计算方式">
              <Select style={{ width: 140 }} options={Object.entries(COMMISSION_METHOD_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
            </Form.Item>
          </Space>
          <Form.Item name="fundSettlementMode" label="资金结算模式">
            <Select options={Object.entries(FUND_MODE_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          <Form.Item name="settlementCondition" label="结算条件">
            <Select options={Object.entries(SETTLEMENT_COND_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          <Space>
            <Form.Item name="contactName" label="联系人"><Input /></Form.Item>
            <Form.Item name="contactInfo" label="联系方式"><Input /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}
