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
  Upload,
  message,
} from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import client, { downloadFile } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import {
  CUSTOMER_STATUS_COLOR,
  CUSTOMER_STATUS_LABEL,
  FOLLOW_METHOD_LABEL,
  INTENTION_LABEL,
  ORDER_STATUS_LABEL,
  SALES_STAGE_LABEL,
  SOURCE_LABEL,
  fmtDate,
  fmtMoney,
} from '../api/types'
import { moneyIn } from '../api/money'
import { ActionBtn, DeleteBtn } from '../components/Actions'
import { COL, smallTableProps } from '../components/tableLayout'

type Any = Record<string, any>

export default function CustomerDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const [c, setC] = useState<Any | null>(null)
  const [followOpen, setFollowOpen] = useState(false)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Any[]>([])
  const [form] = Form.useForm()
  const canFollow = user?.role === 'SALES' || user?.role === 'BUSINESS_SUPERVISOR' || user?.role === 'ADMIN'
  const isAdmin = user?.role === 'ADMIN'

  const load = () => client.get(`/customers/${id}`).then((r) => setC(r.data))
  const loadAtt = () =>
    client.get('/attachments', { params: { relatedType: 'Customer', relatedId: id } }).then((r) => setAttachments(r.data))
  useEffect(() => {
    load()
    loadAtt()
  }, [id])
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
  const setStage = async (salesStage: string) => {
    await client.post(`/customers/${id}/sales-stage`, { salesStage })
    message.success('已更新销售阶段')
    load()
  }
  const doAi = async () => {
    const { data } = await client.get(`/customers/${id}/ai-summary`)
    setAiSummary(data.summary)
  }
  const delOrder = async (oid: number) => {
    try {
      await client.delete(`/orders/${oid}`)
      message.success('已删除')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '删除失败')
    }
  }

  return (
    <div>
      <Card
        title={
          <Space wrap>
            {c.name}
            <Tag color={CUSTOMER_STATUS_COLOR[c.mainStatus]}>{CUSTOMER_STATUS_LABEL[c.mainStatus]}</Tag>
            {c.intentionLevel && <Tag color="purple">{INTENTION_LABEL[c.intentionLevel]}</Tag>}
            {c.salesStage && <Tag color="geekblue">{SALES_STAGE_LABEL[c.salesStage]}</Tag>}
            {c.hasProblem && <Tag color="red">有问题</Tag>}
          </Space>
        }
        extra={
          canFollow && (
            <Space>
              <Select
                size="small"
                placeholder="销售阶段"
                style={{ width: 120 }}
                value={c.salesStage || undefined}
                onChange={setStage}
                options={Object.entries(SALES_STAGE_LABEL).map(([k, v]) => ({ value: k, label: v }))}
              />
              <Button size="small" onClick={doAi}>AI 摘要</Button>
            </Space>
          )
        }
        style={{ marginBottom: 16 }}
      >
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="编号">{c.customerNo}</Descriptions.Item>
          <Descriptions.Item label="时间">{fmtDate(c.discoveredAt ?? c.createdAt)}</Descriptions.Item>
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
                  {...smallTableProps}
                  rowKey="id"
                  dataSource={c.followUps || []}
                  pagination={false}
                  columns={[
                    { title: '时间', dataIndex: 'followedAt', width: COL.datetime, render: (t) => dayjs(t).format('MM-DD HH:mm') },
                    { title: '方式', dataIndex: 'method', width: COL.type, render: (m) => FOLLOW_METHOD_LABEL[m] },
                    { title: '内容', dataIndex: 'content', width: COL.note },
                    { title: '结果', dataIndex: 'result', width: COL.text },
                    { title: '下次', dataIndex: 'nextFollowUpAt', width: COL.date, render: (t) => (t ? dayjs(t).format('MM-DD') : '—') },
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
                {...smallTableProps}
                rowKey="id"
                dataSource={c.orders || []}
                pagination={false}
                columns={[
                  { title: '订单号', dataIndex: 'orderNo', width: COL.no },
                  { title: '时间', dataIndex: 'signedAt', width: COL.date, render: fmtDate },
                  { title: '币种', dataIndex: 'currency', width: COL.currency },
                  { title: '应收', dataIndex: 'receivableAmount', width: COL.money, render: fmtMoney, align: 'right' },
                  { title: '已收', dataIndex: 'paidAmount', width: COL.money, render: moneyIn, align: 'right' },
                  { title: '未收', dataIndex: 'unpaidAmount', width: COL.money, render: fmtMoney, align: 'right' },
                  { title: '状态', dataIndex: 'status', width: COL.status, render: (s) => <Tag>{ORDER_STATUS_LABEL[s]}</Tag> },
                  ...(isAdmin
                    ? [
                        {
                          title: '操作',
                          width: COL.action,
                          render: (_: any, r: Any) => <DeleteBtn onConfirm={() => delOrder(r.id)} />,
                        },
                      ]
                    : []),
                ]}
              />
            ),
          },
          {
            key: 'referrals',
            label: `转介绍收佣 (${c.referrals?.length || 0})`,
            children: (
              <Table
                {...smallTableProps}
                rowKey="id"
                dataSource={c.referrals || []}
                pagination={false}
                columns={[
                  { title: '服务种类', dataIndex: 'serviceType', width: COL.type },
                  { title: '下游公司', dataIndex: 'downstreamCompany', width: COL.company },
                  { title: '佣金', dataIndex: 'commissionAmount', width: COL.money, render: fmtMoney, align: 'right' },
                  { title: '币种', dataIndex: 'currency', width: COL.currency },
                  { title: '收款', dataIndex: 'collectionStatus', width: COL.status, render: (s) => (s === 'COLLECTED' ? '已收款' : '待收款') },
                ]}
              />
            ),
          },
          {
            key: 'attachments',
            label: `附件 (${attachments.length})`,
            children: (
              <>
                <Upload
                  showUploadList={false}
                  customRequest={async ({ file }) => {
                    const fd = new FormData()
                    fd.append('file', file as File)
                    fd.append('relatedType', 'Customer')
                    fd.append('relatedId', String(id))
                    await client.post('/attachments', fd)
                    message.success('已上传')
                    loadAtt()
                  }}
                >
                  <Button icon={<UploadOutlined />} style={{ marginBottom: 12 }}>上传合同 / 凭证</Button>
                </Upload>
                <Table
                  {...smallTableProps}
                  rowKey="id"
                  dataSource={attachments}
                  pagination={false}
                  columns={[
                    { title: '文件名', dataIndex: 'fileName', width: COL.note },
                    { title: '类型', dataIndex: 'fileType', width: COL.type },
                    { title: '上传时间', dataIndex: 'createdAt', width: COL.datetime, render: (t) => dayjs(t).format('MM-DD HH:mm') },
                    {
                      title: '操作',
                      width: COL.action,
                      render: (_: any, r: Any) => (
                        <ActionBtn tone="view" onClick={() => downloadFile(`/attachments/${r.id}/file`, r.fileName)}>下载</ActionBtn>
                      ),
                    },
                  ]}
                />
              </>
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

      <Modal title="AI 跟进摘要" open={!!aiSummary} onCancel={() => setAiSummary(null)} footer={null}>
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{aiSummary}</pre>
      </Modal>
    </div>
  )
}
