import { useEffect, useMemo, useRef, useState } from 'react'
import type { AxiosRequestConfig } from 'axios'
import {
  Alert,
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
import { apiErrorMessage } from '../api/errors'
import { ActionBtn, DeleteBtn } from '../components/Actions'
import { COL, scrollTableProps, smallTableProps } from '../components/tableLayout'
import { useAuth } from '../auth/AuthContext'
import { sortByChannelNameKeyword } from '../utils/channelSort'
import {
  CHANNEL_TYPE_LABEL,
  COMMISSION_METHOD_LABEL,
  FUND_MODE_LABEL,
  LEDGER_TYPE_LABEL,
  SETTLEMENT_COND_LABEL,
} from '../api/types'

type MoneyValue = number | string

interface ChannelRow {
  id: number
  name: string
  channelType: string
  commissionMethod: string
  defaultCommissionAmount?: MoneyValue | null
  defaultCommissionRate?: MoneyValue | null
  fundSettlementMode: string
  settlementCondition: string
  contactName?: string | null
  contactInfo?: string | null
}

interface ChannelFormValues {
  name: string
  channelType: string
  commissionMethod?: string
  defaultCommissionAmount?: number
  defaultCommissionRate?: number
  fundSettlementMode?: string
  settlementCondition?: string
  contactName?: string
  contactInfo?: string
}

interface CommissionSyncResult {
  updated: number
  protected: number
  unchanged: number
  total: number
}

interface ChannelUpdateResult extends ChannelRow {
  commissionSync?: CommissionSyncResult | null
}

interface AcquisitionChannelRow {
  id: number
  name: string
  active: boolean
}

interface AcquisitionChannelFormValues {
  name: string
}

interface LedgerEntry {
  id: number
  createdAt: string
  currency: string
  entryType: string
  amount: MoneyValue
  balanceAfter: MoneyValue
  note?: string | null
}

interface LedgerData {
  balances: { CNY: MoneyValue; JPY: MoneyValue }
  entries: LedgerEntry[]
}

type NoCacheRequestConfig = AxiosRequestConfig & { noCache: true }

function noCacheConfig(signal?: AbortSignal): NoCacheRequestConfig {
  return { noCache: true, signal }
}

async function requestChannels(signal?: AbortSignal) {
  const { data } = await client.get<ChannelRow[]>('/channels', noCacheConfig(signal))
  return data
}

async function requestAcquisitionChannels(signal?: AbortSignal) {
  const { data } = await client.get<AcquisitionChannelRow[]>(
    '/acquisition-channels/all',
    noCacheConfig(signal),
  )
  return data
}

export default function Channels() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [rows, setRows] = useState<ChannelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [syncingCommissions, setSyncingCommissions] = useState(false)
  const [editing, setEditing] = useState<ChannelRow | null>(null)
  const [form] = Form.useForm<ChannelFormValues>()
  const [ledger, setLedger] = useState<LedgerData | null>(null)
  const [acqRows, setAcqRows] = useState<AcquisitionChannelRow[]>([])
  const [acqOpen, setAcqOpen] = useState(false)
  const [acqEditing, setAcqEditing] = useState<AcquisitionChannelRow | null>(null)
  const [acqForm] = Form.useForm<AcquisitionChannelFormValues>()
  const channelRequestId = useRef(0)
  const acquisitionRequestId = useRef(0)
  const commissionMethod = Form.useWatch('commissionMethod', form)
  const sortedRows = useMemo(() => sortByChannelNameKeyword(rows), [rows])
  const openLedger = async (id: number) => {
    const { data } = await client.get<LedgerData>(`/channels/${id}/ledger`)
    setLedger(data)
  }

  const load = () => {
    const requestId = ++channelRequestId.current
    setLoading(true)
    setLoadError('')
    void requestChannels()
      .then((data) => {
        if (requestId !== channelRequestId.current) return
        setRows(data)
        setLoadError('')
      })
      .catch((error: unknown) => {
        if (requestId === channelRequestId.current) {
          setLoadError(apiErrorMessage(error, '渠道数据加载失败，请检查后端或数据库连接'))
        }
      })
      .finally(() => {
        if (requestId === channelRequestId.current) setLoading(false)
      })
  }

  const loadAcq = () => {
    const requestId = ++acquisitionRequestId.current
    void requestAcquisitionChannels()
      .then((data) => {
        if (requestId === acquisitionRequestId.current) setAcqRows(data)
      })
      .catch((error: unknown) => {
        if (requestId === acquisitionRequestId.current) {
          message.error(apiErrorMessage(error, '获取渠道数据加载失败'))
        }
      })
  }

  useEffect(() => {
    const controller = new AbortController()
    const channelRequest = ++channelRequestId.current
    const acquisitionRequest = ++acquisitionRequestId.current
    void requestChannels(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && channelRequest === channelRequestId.current) {
          setRows(data)
          setLoadError('')
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && channelRequest === channelRequestId.current) {
          setLoadError(apiErrorMessage(error, '渠道数据加载失败，请检查后端或数据库连接'))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && channelRequest === channelRequestId.current) {
          setLoading(false)
        }
      })
    void requestAcquisitionChannels(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && acquisitionRequest === acquisitionRequestId.current) {
          setAcqRows(data)
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && acquisitionRequest === acquisitionRequestId.current) {
          message.error(apiErrorMessage(error, '获取渠道数据加载失败'))
        }
      })
    return () => controller.abort()
  }, [])

  const openForm = (rec?: ChannelRow) => {
    setEditing(rec || null)
    form.resetFields()
    if (rec) form.setFieldsValue({
      name: rec.name,
      channelType: rec.channelType,
      commissionMethod: rec.commissionMethod,
      fundSettlementMode: rec.fundSettlementMode,
      settlementCondition: rec.settlementCondition,
      contactName: rec.contactName ?? undefined,
      contactInfo: rec.contactInfo ?? undefined,
      defaultCommissionRate: rec.defaultCommissionRate != null ? Number(rec.defaultCommissionRate) : undefined,
      defaultCommissionAmount: rec.defaultCommissionAmount != null ? Number(rec.defaultCommissionAmount) : undefined,
    })
    else form.setFieldsValue({ channelType: isAdmin ? 'ENTERPRISE' : 'INDIVIDUAL', commissionMethod: 'NET_RECEIVED_RATIO', fundSettlementMode: 'COMPANY_REBATE', settlementCondition: 'ON_SERVICE_COMPLETE' })
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      if (editing) {
        const { data } = await client.patch<ChannelUpdateResult>(
          `/channels/${editing.id}`,
          v,
        )
        const sync = data.commissionSync
        message.success(
          sync
            ? `已保存并同步 ${sync.updated} 条未结算返佣${sync.protected ? `；${sync.protected} 条历史/风险记录保持不变` : ''}`
            : '已保存',
        )
      } else {
        await client.post('/channels', v)
        message.success('已保存')
      }
      setOpen(false)
      load()
    } catch (error: unknown) {
      message.error(apiErrorMessage(error, '操作失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const openAcq = (rec?: AcquisitionChannelRow) => {
    setAcqEditing(rec || null)
    acqForm.resetFields()
    if (rec) acqForm.setFieldsValue({ name: rec.name })
    setAcqOpen(true)
  }
  const submitAcq = async () => {
    const v = await acqForm.validateFields()
    try {
      if (acqEditing) await client.patch(`/acquisition-channels/${acqEditing.id}`, { name: v.name })
      else await client.post('/acquisition-channels', { name: v.name })
      message.success('已保存')
      setAcqOpen(false)
      loadAcq()
    } catch (error: unknown) {
      message.error(apiErrorMessage(error, '操作失败（名称可能重复）'))
    }
  }

  const syncCommissionPricing = async () => {
    setSyncingCommissions(true)
    try {
      const { data } = await client.post<CommissionSyncResult>(
        '/channels/sync-commission-pricing',
      )
      message.success(
        `已同步 ${data.updated} 条未结算返佣${data.protected ? `；${data.protected} 条历史/风险记录保持不变` : ''}`,
      )
    } catch (error: unknown) {
      message.error(apiErrorMessage(error, '返佣同步失败'))
      throw error
    } finally {
      setSyncingCommissions(false)
    }
  }

  const confirmCommissionPricingSync = () => {
    Modal.confirm({
      title: '按当前渠道比例同步未结算返佣？',
      content: '只更新尚未支付且无退款追回的记录；已支付、部分支付及历史记录不会改变。',
      okText: '确认同步',
      cancelText: '取消',
      onOk: syncCommissionPricing,
    })
  }
  const toggleAcq = async (rec: AcquisitionChannelRow) => {
    await client.patch(`/acquisition-channels/${rec.id}`, { active: !rec.active })
    loadAcq()
  }
  const doRemoveAcq = async (id: number) => {
    try {
      await client.delete(`/acquisition-channels/${id}`)
      message.success('已删除')
      loadAcq()
    } catch (error: unknown) {
      message.error(apiErrorMessage(error, '删除失败'))
    }
  }
  const doRemove = async (id: number) => {
    try {
      await client.delete(`/channels/${id}`)
      message.success('已删除')
      load()
    } catch (error: unknown) {
      message.error(apiErrorMessage(error, '删除失败'))
    }
  }

  return (
    <div>
      <div>
        <Space style={{ marginBottom: 16 }} wrap>
          <Button type="primary" onClick={() => openForm()}>
            {isAdmin ? '新增渠道' : '新增个人渠道'}
          </Button>
          {isAdmin && (
            <Button
              loading={syncingCommissions}
              onClick={confirmCommissionPricingSync}
            >
              同步未结算返佣
            </Button>
          )}
        </Space>
        {loadError && (
          <Alert
            type="error"
            showIcon
            message={loadError}
            action={<Button size="small" onClick={load}>重新加载</Button>}
            style={{ marginBottom: 16 }}
          />
        )}
        <Table
          {...scrollTableProps}
          pagination={false}
          scroll={{ x: 'max-content' }}
          rowKey="id"
          loading={loading}
          dataSource={sortedRows}
          columns={[
            { title: '名称', dataIndex: 'name', width: COL.channel },
            { title: '类型', dataIndex: 'channelType', width: COL.type, render: (t) => <Tag>{CHANNEL_TYPE_LABEL[t]}</Tag> },
            {
              title: '默认返佣',
              width: COL.money,
              render: (_, r) =>
                r.commissionMethod === 'FIXED_AMOUNT'
                  ? (r.defaultCommissionAmount != null ? Number(r.defaultCommissionAmount).toLocaleString() : '—')
                  : (r.defaultCommissionRate != null ? `${r.defaultCommissionRate}%` : '—'),
            },
            { title: '计算方式', dataIndex: 'commissionMethod', width: COL.method, render: (m) => COMMISSION_METHOD_LABEL[m] },
            { title: '资金模式', dataIndex: 'fundSettlementMode', width: COL.mode, render: (m) => FUND_MODE_LABEL[m] },
            { title: '结算条件', dataIndex: 'settlementCondition', width: COL.condition, render: (s) => SETTLEMENT_COND_LABEL[s] },
            {
              title: '操作',
              width: COL.action,
              render: (_, r) =>
                isAdmin ? (
                  <Space wrap>
                    <ActionBtn tone="edit" onClick={() => openForm(r)}>编辑</ActionBtn>
                    <ActionBtn tone="view" onClick={() => openLedger(r.id)}>台账</ActionBtn>
                    <DeleteBtn onConfirm={() => doRemove(r.id)} />
                  </Space>
                ) : null,
            },
          ]}
        />
      </div>

      <Modal title="往来 / 抵扣台账（按币种）" open={!!ledger} onCancel={() => setLedger(null)} footer={null} width={760}>
        {ledger && (
          <>
            <div style={{ marginBottom: 12 }}>
              当前余额（正=第三方欠公司，负=公司欠第三方）： CNY <b>{ledger.balances.CNY}</b> ， JPY <b>{ledger.balances.JPY}</b>
            </div>
            <Table
              {...smallTableProps}
              rowKey="id"
              pagination={false}
              dataSource={ledger.entries}
              columns={[
                { title: '时间', dataIndex: 'createdAt', width: COL.datetime, render: (t: string) => dayjs(t).format('MM-DD HH:mm') },
                { title: '币种', dataIndex: 'currency', width: COL.currency },
                { title: '类型', dataIndex: 'entryType', width: COL.method, render: (e: string) => LEDGER_TYPE_LABEL[e] || e },
                { title: '金额', dataIndex: 'amount', width: COL.money, align: 'right' },
                { title: '余额', dataIndex: 'balanceAfter', width: COL.money, align: 'right' },
                { title: '说明', dataIndex: 'note', width: COL.note },
              ]}
            />
          </>
        )}
      </Modal>
      <Modal title={editing ? '编辑渠道' : '新增渠道'} open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={submitting} okText={submitting ? '处理中…' : '确定'} maskClosable={false} cancelButtonProps={{ disabled: submitting }} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="渠道名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="channelType" label="类型" rules={[{ required: true }]}>
            <Select disabled={!isAdmin} options={Object.entries(CHANNEL_TYPE_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          <Space>
            <Form.Item name="commissionMethod" label="计算方式">
              <Select style={{ width: 140 }} options={Object.entries(COMMISSION_METHOD_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
            </Form.Item>
            {commissionMethod === 'FIXED_AMOUNT' ? (
              <Form.Item name="defaultCommissionAmount" label="默认固定金额" rules={[{ required: true, message: '请填写固定返佣金额' }]}>
                <InputNumber min={0} controls={false} />
              </Form.Item>
            ) : (
              <Form.Item name="defaultCommissionRate" label="默认分成比例 %" rules={[{ required: true, message: '请填写返佣比例' }]}>
                <InputNumber min={0} max={100} />
              </Form.Item>
            )}
          </Space>
          <Form.Item name="fundSettlementMode" label="资金结算模式">
            <Select options={Object.entries(FUND_MODE_LABEL).filter(([k]) => k !== 'COMPANY_DIRECT').map(([k, v]) => ({ value: k, label: v }))} />
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

      <div style={{ marginTop: 28 }}>
        <Space style={{ marginBottom: 12 }} wrap>
          <b style={{ fontSize: 15 }}>获取渠道字典（自获取来源用）</b>
          <Button type="primary" onClick={() => openAcq()}>新增获取渠道</Button>
        </Space>
        <Table
          {...smallTableProps}
          rowKey="id"
          pagination={false}
          dataSource={acqRows}
          columns={[
            { title: '名称', dataIndex: 'name', width: COL.name },
            { title: '状态', dataIndex: 'active', width: COL.status, render: (a: boolean) => <Tag color={a ? 'green' : 'default'}>{a ? '启用' : '停用'}</Tag> },
            {
              title: '操作',
              width: COL.actionWide,
              render: (_: unknown, r: AcquisitionChannelRow) => (
                <Space wrap>
                  <ActionBtn tone="edit" onClick={() => openAcq(r)}>重命名</ActionBtn>
                  {r.active ? (
                    <ActionBtn tone="reject" onClick={() => toggleAcq(r)}>停用</ActionBtn>
                  ) : (
                    <ActionBtn tone="confirm" onClick={() => toggleAcq(r)}>启用</ActionBtn>
                  )}
                  <DeleteBtn onConfirm={() => doRemoveAcq(r.id)} />
                </Space>
              ),
            },
          ]}
        />
      </div>

      <Modal title={acqEditing ? '重命名获取渠道' : '新增获取渠道'} open={acqOpen} onCancel={() => setAcqOpen(false)} onOk={submitAcq} maskClosable={false} destroyOnClose>
        <Form form={acqForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
