import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd'
import dayjs from 'dayjs'
import client from '../api/client'
import { useAuth } from '../auth/AuthContext'
import {
  CUSTOMER_STATUS_COLOR,
  CUSTOMER_STATUS_LABEL,
  FOLLOW_METHOD_LABEL,
  INTENTION_LABEL,
  ORDER_STATUS_LABEL,
  SOURCE_LABEL,
  fmtMoney,
} from '../api/types'

type Any = Record<string, any>

export default function CustomerDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const [c, setC] = useState<Any | null>(null)
  const [followOpen, setFollowOpen] = useState(false)
  const [form] = Form.useForm()
  const canFollow = user?.role === 'SALES' || user?.role === 'ADMIN'

  const load = () => client.get(`/customers/${id}`).then((r) => setC(r.data))
  useEffect(() => { load() }, [id])
  if (!c) return null

  const addFollow = async () => {
    const v = await form.validateFields()
    await client.post(`/customers/${id}/follow-ups`, {
      ...v,
      nextFollowUpAt: v.nextFollowUpAt ? dayjs(v.nextFollowUpAt).toISOString() : undefined,
    })
    message.success('已记录跟进')
    setFollowOpen(false)
    form.resetFields()
    load()
  }

  return (
    <div>
      <Card
        title={
          <Space>
            {c.name}
            <Tag color={CUSTOMER_STATUS_COLOR[c.mainStatus]}>{CUSTOMER_STATUS_LABEL[c.mainStatus]}</Tag>
            {c.intentionLevel && <Tag color="purple">{INTENTION_LABEL[c.intentionLevel]}</Tag>}
            {c.hasProblem && <Tag color="red">有问题</Tag>}
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="编号">{c.customerNo}</Descriptions.Item>
          <Descriptions.Item label="电话">{c.phone || '—'}</Descriptions.Item>
          <Descriptions.Item label="微信">{c.wechat || '—'}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{c.email || '—'}</Descriptions.Item>
          <Descriptions.Item label="来源">{SOURCE_LABEL[c.sourceCategory]}</Descriptions.Item>
          <Descriptions.Item label="渠道">
            {c.channel?.name || c.acquisitionChannel?.name || '—'}
            {c.commissionRateSnapshot != null && `（比例快照 ${c.commissionRateSnapshot}%）`}
          </Descriptions.Item>
          <Descriptions.Item label="下次跟进">
            {c.nextFollowUpAt ? dayjs(c.nextFollowUpAt).format('YYYY-MM-DD HH:mm') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="备注" span={2}>{c.remark || '—'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Tabs
        items={[
          {
            key: 'follow',
            label: `跟进记录 (${c.followUps?.length || 0})`,
            children: (
              <>
                {canFollow && (
                  <Button type="primary" style={{ marginBottom: 12 }} onClick={() => setFollowOpen(true)}>
                    新增跟进
                  </Button>
                )}
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={c.followUps || []}
                  pagination={false}
                  columns={[
                    { title: '时间', dataIndex: 'followedAt', render: (t) => dayjs(t).format('MM-DD HH:mm') },
                    { title: '方式', dataIndex: 'method', render: (m) => FOLLOW_METHOD_LABEL[m] },
                    { title: '内容', dataIndex: 'content' },
                    { title: '结果', dataIndex: 'result' },
                    { title: '下次', dataIndex: 'nextFollowUpAt', render: (t) => (t ? dayjs(t).format('MM-DD') : '—') },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'orders',
            label: `订单 (${c.orders?.length || 0})`,
            children: (
              <Table
                rowKey="id"
                size="small"
                dataSource={c.orders || []}
                pagination={false}
                columns={[
                  { title: '订单号', dataIndex: 'orderNo' },
                  { title: '币种', dataIndex: 'currency' },
                  { title: '应收', dataIndex: 'receivableAmount', render: fmtMoney, align: 'right' },
                  { title: '已收', dataIndex: 'paidAmount', render: fmtMoney, align: 'right' },
                  { title: '未收', dataIndex: 'unpaidAmount', render: fmtMoney, align: 'right' },
                  { title: '状态', dataIndex: 'status', render: (s) => <Tag>{ORDER_STATUS_LABEL[s]}</Tag> },
                ]}
              />
            ),
          },
          {
            key: 'referrals',
            label: `转介绍收佣 (${c.referrals?.length || 0})`,
            children: (
              <Table
                rowKey="id"
                size="small"
                dataSource={c.referrals || []}
                pagination={false}
                columns={[
                  { title: '服务种类', dataIndex: 'serviceType' },
                  { title: '下游公司', dataIndex: 'downstreamCompany' },
                  { title: '佣金', dataIndex: 'commissionAmount', render: fmtMoney, align: 'right' },
                  { title: '币种', dataIndex: 'currency' },
                  { title: '收款', dataIndex: 'collectionStatus', render: (s) => (s === 'COLLECTED' ? '已收款' : '待收款') },
                ]}
              />
            ),
          },
        ]}
      />

      <Modal title="新增跟进" open={followOpen} onCancel={() => setFollowOpen(false)} onOk={addFollow} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="method" label="方式" rules={[{ required: true }]}>
            <Select options={Object.entries(FOLLOW_METHOD_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          <Form.Item name="content" label="跟进内容" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="result" label="本次结果"><Input /></Form.Item>
          <Form.Item name="nextFollowUpAt" label="下次跟进时间">
            <Input type="datetime-local" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
