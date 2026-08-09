import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Upload,
  message,
} from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { ActionBtn, DeleteBtn } from '../components/Actions'
import { COL, scrollTableProps } from '../components/tableLayout'
import client, { downloadFile } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import {
  loadAcqChannels,
  loadChannelOptions,
  loadUserOptions,
} from '../api/options'
import {
  CUSTOMER_STATUS_LABEL,
  CUSTOMER_STATUS_STYLE,
  INTENTION_LABEL,
  SOURCE_LABEL,
  fmtDate,
  todayDate,
} from '../api/types'

type Any = Record<string, any>
const UNASSIGNED_FILTER = '__UNASSIGNED__'
const customerStatusCssVars = (status: string) => {
  const style = CUSTOMER_STATUS_STYLE[status]
  return {
    '--customer-status-color': style.color,
    '--customer-status-bg': style.backgroundColor,
    '--customer-status-border': style.borderColor,
    '--ant-select-background-color': style.backgroundColor,
    '--ant-select-border-color': style.borderColor,
  } as CSSProperties
}
const customerStatusOptions = Object.entries(CUSTOMER_STATUS_LABEL).map(([value, label]) => ({
  value,
  label: <span className="customer-status-option" style={customerStatusCssVars(value)}>{label}</span>,
}))

function sourceChannelLabel(r: Any) {
  const channelName = r.channel?.name || r.acquisitionChannel?.name
  return `${SOURCE_LABEL[r.sourceCategory] || ''}${channelName ? '：' + channelName : ''}` || '—'
}

function uniqueFilters(rows: Any[], getLabel: (row: Any) => string, getValue: (row: Any) => string = getLabel) {
  const seen = new Map<string, string>()
  rows.forEach((row) => {
    const label = getLabel(row) || '—'
    const value = getValue(row) || label
    if (!seen.has(value)) seen.set(value, label)
  })
  return Array.from(seen.entries())
    .sort(([, a], [, b]) => a.localeCompare(b, 'zh-CN'))
    .map(([value, label]) => ({ text: label, value }))
}

export default function Customers() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [data, setData] = useState<{ items: Any[]; total: number }>({ items: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [assignTarget, setAssignTarget] = useState<Any | null>(null)
  const [form] = Form.useForm()
  const [sourceCat, setSourceCat] = useState('SELF')
  const [channels, setChannels] = useState<Any[]>([])
  const [acq, setAcq] = useState<Any[]>([])
  const [sales, setSales] = useState<Any[]>([])
  const [editCust, setEditCust] = useState<Any | null>(null)
  const [editForm] = Form.useForm()
  const [editSourceCat, setEditSourceCat] = useState('SELF')
  const [inlineUpdatingId, setInlineUpdatingId] = useState<number | null>(null)

  const canCreate = user?.role === 'MARKET' || user?.role === 'BUSINESS_SUPERVISOR' || user?.role === 'ADMIN'
  const canEditCustomerName = user?.role === 'BUSINESS_SUPERVISOR' || user?.role === 'ADMIN'

  const load = () => {
    setLoading(true)
    client
      .get('/customers', { params: { all: 1, search: search || undefined } })
      .then((r) => setData(r.data))
      .finally(() => setLoading(false))
  }
  useEffect(load, [search])

  const openCreate = async () => {
    form.resetFields()
    form.setFieldsValue({ sourceCategory: 'SELF', discoveredAt: todayDate() })
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
    try {
      await client.delete(`/customers/${id}`)
      message.success('已删除')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '删除失败')
    }
  }

  const openQuickEdit = async (r: Any) => {
    setChannels(await loadChannelOptions().catch(() => []))
    setAcq(await loadAcqChannels().catch(() => []))
    setEditSourceCat(r.sourceCategory)
    editForm.setFieldsValue({
      name: r.name,
      intentionLevel: r.intentionLevel ?? undefined,
      mainStatus: r.mainStatus,
      sourceCategory: r.sourceCategory,
      channelId: r.channel?.id,
      acquisitionChannelId: r.acquisitionChannel?.id,
      discoveredAt: fmtDate(r.discoveredAt ?? r.createdAt),
    })
    setEditCust(r)
  }
  const submitQuickEdit = async () => {
    const v = await editForm.validateFields()
    setSubmitting(true)
    try {
      const payload: Any = {
        intentionLevel: v.intentionLevel ?? null,
        mainStatus: v.mainStatus,
        sourceCategory: v.sourceCategory,
        channelId: v.sourceCategory === 'SELF' ? null : (v.channelId ?? null),
        acquisitionChannelId: v.sourceCategory === 'SELF' ? (v.acquisitionChannelId ?? null) : null,
        discoveredAt: v.discoveredAt,
      }
      if (canEditCustomerName) payload.name = v.name
      await client.patch(`/customers/${editCust!.id}`, {
        ...payload,
      })
      message.success('已修改')
      setEditCust(null)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const updateInline = async (id: number, payload: Any) => {
    setInlineUpdatingId(id)
    try {
      await client.patch(`/customers/${id}`, payload)
      message.success('已修改')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '操作失败')
    } finally {
      setInlineUpdatingId(null)
    }
  }

  const sourceFilters = useMemo(() => uniqueFilters(data.items, sourceChannelLabel), [data.items])
  const ownerFilters = useMemo(
    () =>
      uniqueFilters(
        data.items,
        (r) => r.ownerName || '未分配',
        (r) => (r.ownerUserId ? String(r.ownerUserId) : UNASSIGNED_FILTER),
      ),
    [data.items],
  )
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = Object.fromEntries(Object.keys(CUSTOMER_STATUS_LABEL).map((status) => [status, 0]))
    data.items.forEach((row) => {
      if (row.mainStatus in counts) counts[row.mainStatus] += 1
    })
    return counts
  }, [data.items])
  const statusFilters = useMemo(
    () => Object.entries(CUSTOMER_STATUS_LABEL).map(([value, label]) => ({
      value,
      text: (
        <span className="customer-status-filter-option" style={customerStatusCssVars(value)}>
          <span>{label}</span>
          <span className="customer-status-filter-count">{statusCounts[value]}</span>
        </span>
      ),
    })),
    [statusCounts],
  )

  const columns = [
    { title: '编号', dataIndex: 'customerNo', width: COL.no },
    { title: '时间', dataIndex: 'discoveredAt', width: COL.date, render: (t: string, r: Any) => fmtDate(t ?? r.createdAt) },
    { title: '姓名', dataIndex: 'name', width: COL.person, render: (n: string, r: Any) => <a onClick={() => nav(`/customers/${r.id}`)}>{n}</a> },
    {
      title: '来源 / 渠道',
      width: COL.source,
      filters: sourceFilters,
      filterSearch: true,
      onFilter: (value: any, r: Any) => sourceChannelLabel(r) === value,
      render: (_: any, r: Any) => (
        <a onClick={() => openQuickEdit(r)}>
          {sourceChannelLabel(r)}
        </a>
      ),
    },
    {
      title: '状态',
      dataIndex: 'mainStatus',
      width: COL.status,
      filters: statusFilters,
      onFilter: (value: any, r: Any) => r.mainStatus === value,
      render: (s: string, r: Any) => (
        <Select
          className="customer-inline-select customer-status-select"
          size="small"
          value={s}
          disabled={inlineUpdatingId === r.id}
          popupMatchSelectWidth={false}
          style={{ width: '100%', ...customerStatusCssVars(s) }}
          options={customerStatusOptions}
          onChange={(value) => updateInline(r.id, { mainStatus: value })}
        />
      ),
    },
    {
      title: '意向',
      dataIndex: 'intentionLevel',
      width: COL.status,
      filters: [
        ...Object.entries(INTENTION_LABEL).map(([value, label]) => ({ text: label, value })),
        { text: '未填写', value: '__EMPTY__' },
      ],
      onFilter: (value: any, r: Any) => (value === '__EMPTY__' ? !r.intentionLevel : r.intentionLevel === value),
      render: (i: string, r: Any) => (
        <Select
          className="customer-inline-select"
          allowClear
          size="small"
          placeholder="未填写"
          value={i || undefined}
          disabled={inlineUpdatingId === r.id}
          popupMatchSelectWidth={false}
          style={{ width: '100%' }}
          options={Object.entries(INTENTION_LABEL).map(([value, label]) => ({ value, label }))}
          onChange={(value) => updateInline(r.id, { intentionLevel: value ?? null })}
        />
      ),
    },
    {
      title: '分配',
      width: COL.status,
      filters: ownerFilters,
      filterSearch: true,
      onFilter: (value: any, r: Any) => (r.ownerUserId ? String(r.ownerUserId) : UNASSIGNED_FILTER) === value,
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
      width: COL.action,
      render: (_: any, r: Any) => (
        <Space wrap>
          <ActionBtn tone="view" onClick={() => nav(`/customers/${r.id}`)}>详情</ActionBtn>
          {canEditCustomerName && <ActionBtn tone="edit" onClick={() => openQuickEdit(r)}>修改</ActionBtn>}
          {user?.role === 'ADMIN' && <DeleteBtn onConfirm={() => doDelete(r.id)} />}
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search placeholder="姓名/电话/微信/编号" allowClear onSearch={setSearch} style={{ width: 240 }} />
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
        {...scrollTableProps}
        className="customer-list-table"
        rowKey="id"
        loading={loading}
        columns={columns as any}
        dataSource={data.items}
      />

      <Modal title="新增客户" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => submitCreate(false)} confirmLoading={submitting} okText={submitting ? '处理中…' : '确定'} maskClosable={false} cancelButtonProps={{ disabled: submitting }} destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ sourceCategory: 'SELF' }}>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="discoveredAt" label="时间">
            <Input type="date" />
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

      <Modal title={canEditCustomerName ? '快速修改（姓名 / 意向 / 状态 / 来源渠道）' : '快速修改（意向 / 状态 / 来源渠道）'} open={!!editCust} onCancel={() => setEditCust(null)} onOk={submitQuickEdit} confirmLoading={submitting} okText={submitting ? '处理中…' : '确定'} maskClosable={false} cancelButtonProps={{ disabled: submitting }} destroyOnClose>
        <Form form={editForm} layout="vertical">
          {canEditCustomerName && (
            <Form.Item name="name" label="姓名" rules={[{ required: true, whitespace: true, message: '请输入客户姓名' }]}>
              <Input />
            </Form.Item>
          )}
          <Form.Item name="intentionLevel" label="意向">
            <Select allowClear options={Object.entries(INTENTION_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          <Form.Item name="mainStatus" label="状态" rules={[{ required: true }]}>
            <Select options={customerStatusOptions} />
          </Form.Item>
          <Form.Item name="discoveredAt" label="时间">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="sourceCategory" label="来源" rules={[{ required: true }]}>
            <Select onChange={(v) => { setEditSourceCat(v); editForm.setFieldValue('channelId', undefined); editForm.setFieldValue('acquisitionChannelId', undefined) }} options={Object.entries(SOURCE_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          {editSourceCat === 'SELF' ? (
            <Form.Item name="acquisitionChannelId" label="获取渠道">
              <Select allowClear options={acq.map((a) => ({ value: a.id, label: a.name }))} />
            </Form.Item>
          ) : (
            <Form.Item name="channelId" label="第三方渠道" rules={[{ required: true }]}>
              <Select options={channels.filter((c) => (editSourceCat === 'INDIVIDUAL_THIRD_PARTY' ? c.channelType === 'INDIVIDUAL' : c.channelType === 'ENTERPRISE')).map((c) => ({ value: c.id, label: c.name }))} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  )
}
