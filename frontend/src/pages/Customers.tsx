import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Upload,
  message,
} from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import client, { downloadFile } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import {
  loadAcqChannels,
  loadChannelOptions,
  loadUserOptions,
} from '../api/options'
import {
  CUSTOMER_STATUS_COLOR,
  CUSTOMER_STATUS_LABEL,
  INTENTION_LABEL,
  SOURCE_LABEL,
} from '../api/types'

type Any = Record<string, any>

export default function Customers() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [data, setData] = useState<{ items: Any[]; total: number }>({ items: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>()
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [assignTarget, setAssignTarget] = useState<Any | null>(null)
  const [form] = Form.useForm()
  const [sourceCat, setSourceCat] = useState('SELF')
  const [channels, setChannels] = useState<Any[]>([])
  const [acq, setAcq] = useState<Any[]>([])
  const [sales, setSales] = useState<Any[]>([])

  const canCreate = user?.role === 'MARKET' || user?.role === 'ADMIN'

  const load = () => {
    setLoading(true)
    client
      .get('/customers', { params: { page, pageSize: 10, search: search || undefined, mainStatus: statusFilter } })
      .then((r) => setData(r.data))
      .finally(() => setLoading(false))
  }
  useEffect(load, [page, search, statusFilter])

  const openCreate = async () => {
    form.resetFields()
    setSourceCat('SELF')
    setChannels(await loadChannelOptions().catch(() => []))
    setAcq(await loadAcqChannels().catch(() => []))
    setSales(await loadUserOptions('SALES').catch(() => []))
    setModalOpen(true)
  }

  const submitCreate = async (force = false) => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      await client.post('/customers', { ...v, force })
      message.success('已创建')
      setModalOpen(false)
      load()
    } catch (e: any) {
      if (e.response?.status === 409) {
        const dups = e.response.data?.duplicates || []
        Modal.confirm({
          title: '疑似重复客户',
          content: `已存在 ${dups.length} 个匹配（${dups.map((d: Any) => d.name).join('、')}），仍要创建吗？`,
          okText: '仍然创建',
          onOk: () => submitCreate(true),
        })
      } else {
        message.error(e.response?.data?.message || '创建失败')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const doAssign = async (ownerUserId: number) => {
    await client.post(`/customers/${assignTarget!.id}/assign`, { ownerUserId })
    message.success('已指派')
    setAssignTarget(null)
    load()
  }

  const doDelete = async (id: number) => {
    await client.delete(`/customers/${id}`)
    message.success('已删除')
    load()
  }

  const columns = [
    { title: '编号', dataIndex: 'customerNo', width: 130 },
    { title: '姓名', dataIndex: 'name' },
    {
      title: '联系方式',
      render: (_: any, r: Any) => [r.phone, r.wechat, r.email].filter(Boolean).join(' / ') || '—',
    },
    {
      title: '来源 / 渠道',
      render: (_: any, r: Any) =>
        `${SOURCE_LABEL[r.sourceCategory] || ''}${r.channel ? '：' + r.channel.name : r.acquisitionChannel ? '：' + r.acquisitionChannel.name : ''}`,
    },
    {
      title: '状态',
      dataIndex: 'mainStatus',
      render: (s: string) => <Tag color={CUSTOMER_STATUS_COLOR[s]}>{CUSTOMER_STATUS_LABEL[s]}</Tag>,
    },
    { title: '意向', dataIndex: 'intentionLevel', render: (i: string) => (i ? INTENTION_LABEL[i] : '—') },
    {
      title: '分配',
      render: (_: any, r: Any) => {
        const label = r.ownerName ? <Tag color="green">{r.ownerName}</Tag> : <Tag>未分配</Tag>
        return canCreate ? (
          <a onClick={async () => { setSales(await loadUserOptions('SALES').catch(() => [])); setAssignTarget(r) }}>{label}</a>
        ) : (
          label
        )
      },
    },
    {
      title: '操作',
      render: (_: any, r: Any) => (
        <Space>
          <a onClick={() => nav(`/customers/${r.id}`)}>详情</a>
          {user?.role === 'ADMIN' && (
            <Popconfirm title="确认删除该客户？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => doDelete(r.id)}>
              <a style={{ color: '#dc2626' }}>删除</a>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search placeholder="姓名/电话/微信/编号" allowClear onSearch={(v) => { setPage(1); setSearch(v) }} style={{ width: 240 }} />
        <Select
          allowClear
          placeholder="状态筛选"
          style={{ width: 140 }}
          value={statusFilter}
          onChange={(v) => { setPage(1); setStatusFilter(v) }}
          options={Object.entries(CUSTOMER_STATUS_LABEL).map(([k, v]) => ({ value: k, label: v }))}
        />
        {canCreate && <Button type="primary" onClick={openCreate}>新增客户</Button>}
        {canCreate && (
          <Upload
            accept=".xlsx"
            showUploadList={false}
            customRequest={async ({ file }) => {
              const fd = new FormData()
              fd.append('file', file as File)
              const { data } = await client.post('/customers/import', fd)
              message.success(`导入：成功${data.success}，重复${data.duplicates}，失败${data.failed}`)
              load()
            }}
          >
            <Button icon={<UploadOutlined />}>导入</Button>
          </Upload>
        )}
        <Button onClick={() => downloadFile('/customers/export', '客户.xlsx')}>导出</Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns as any}
        dataSource={data.items}
        pagination={{ current: page, pageSize: 10, total: data.total, onChange: setPage, showSizeChanger: false }}
      />

      <Modal title="新增客户" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => submitCreate(false)} confirmLoading={submitting} okText={submitting ? '处理中…' : '确定'} maskClosable={false} cancelButtonProps={{ disabled: submitting }} destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ sourceCategory: 'SELF' }}>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space>
            <Form.Item name="phone" label="电话"><Input /></Form.Item>
            <Form.Item name="wechat" label="微信"><Input /></Form.Item>
            <Form.Item name="email" label="邮箱"><Input /></Form.Item>
          </Space>
          <Form.Item name="sourceCategory" label="来源" rules={[{ required: true }]}>
            <Select onChange={(v) => { setSourceCat(v); form.setFieldValue('channelId', undefined) }} options={Object.entries(SOURCE_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          {sourceCat === 'SELF' ? (
            <Form.Item name="acquisitionChannelId" label="获取渠道">
              <Select allowClear options={acq.map((a) => ({ value: a.id, label: a.name }))} />
            </Form.Item>
          ) : (
            <Form.Item name="channelId" label="第三方渠道" rules={[{ required: true }]}>
              <Select options={channels.filter((c) => (sourceCat === 'INDIVIDUAL_THIRD_PARTY' ? c.channelType === 'INDIVIDUAL' : c.channelType === 'ENTERPRISE')).map((c) => ({ value: c.id, label: c.name }))} />
            </Form.Item>
          )}
          <Form.Item name="ownerUserId" label="负责销售（可后续指派）">
            <Select allowClear options={sales.map((s) => ({ value: s.id, label: s.name }))} />
          </Form.Item>
          <Form.Item name="intentionLevel" label="意向">
            <Select allowClear options={Object.entries(INTENTION_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="指派负责销售" open={!!assignTarget} onCancel={() => setAssignTarget(null)} footer={null} destroyOnClose>
        <Select
          style={{ width: '100%' }}
          placeholder="选择销售"
          options={sales.map((s) => ({ value: s.id, label: s.name }))}
          onChange={doAssign}
        />
      </Modal>
    </div>
  )
}
