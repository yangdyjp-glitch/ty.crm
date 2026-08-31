import { useEffect, useMemo, useState } from 'react'
import { Modal, Select, Space, Table, Tabs, Tag, message } from 'antd'
import client from '../api/client'
import { ActionBtn, DeleteBtn } from '../components/Actions'
import { COL, scrollTableProps } from '../components/tableLayout'
import {
  COMMISSION_STATUS_COLOR,
  COMMISSION_STATUS_LABEL,
  CURRENCY_LABEL,
  FUND_MODE_LABEL,
  fmtMoney,
} from '../api/types'

type Any = Record<string, any>
const EMPTY_FILTER = '__EMPTY__'

const CONFIRMABLE_STATUS = ['PENDING_REVIEW', 'PENDING_PAYMENT']
const FINAL_STATUS = ['PAID', 'CANCELLED', 'SELF_DEDUCTED']
const REBATE_STATUS_COLOR: Record<string, string> = {
  未到账: 'default',
  部分自扣: 'gold',
  已自扣: 'blue',
  未返佣: 'orange',
  部分返佣: 'gold',
  已返佣: 'green',
  无返佣: 'green',
}
const isSelfDeducted = (r: Any) =>
  r.fundSettlementMode === 'AGENT_NET' || r.status === 'SELF_DEDUCTED'

const canConfirmPayment = (r: Any) =>
  r.fundSettlementMode === 'COMPANY_REBATE' &&
  CONFIRMABLE_STATUS.includes(r.status) &&
  !r.suspended

function filterValue(v: unknown) {
  return v == null || v === '' ? EMPTY_FILTER : String(v)
}

function filterText(v: unknown) {
  return v == null || v === '' ? '—' : String(v)
}

function uniqueFilters(rows: Any[], getValue: (row: Any) => unknown, getText: (row: Any) => unknown = getValue) {
  const seen = new Map<string, string>()
  rows.forEach((row) => {
    const value = filterValue(getValue(row))
    if (!seen.has(value)) seen.set(value, filterText(getText(row)))
  })
  return Array.from(seen.entries())
    .sort(([, a], [, b]) => a.localeCompare(b, 'zh-CN'))
    .map(([value, text]) => ({ value, text }))
}

export default function Commissions() {
  const [data, setData] = useState<{ items: Any[]; total: number }>({ items: [], total: 0 })
  const [status, setStatus] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [cashData, setCashData] = useState<{ items: Any[]; total: number }>({ items: [], total: 0 })
  const [cashLoading, setCashLoading] = useState(false)

  const load = () => {
    setLoading(true)
    client.get('/commissions', { params: { all: 1, status } }).then((r) => setData(r.data)).finally(() => setLoading(false))
  }

  const loadCash = () => {
    setCashLoading(true)
    client.get('/commissions/cash-accounts', { params: { all: 1 } }).then((r) => setCashData(r.data)).finally(() => setCashLoading(false))
  }

  useEffect(load, [status])
  useEffect(loadCash, [])

  const act = async (row: Any, action: string) => {
    try {
      const endpoint =
        action === 'pay' && row.paymentId
          ? `/commissions/${row.id}/pay-installment/${row.paymentId}`
          : `/commissions/${row.id}/${action}`
      const { data: res } = await client.post(endpoint)
      if (action === 'pay') {
        const paymentText = res.paymentNo ? `（${res.paymentNo}）` : ''
        message.success(`已确认支付${paymentText}：应付 ${fmtMoney(res.payable)}，往来抵扣 ${fmtMoney(res.offset)}，实付现金 ${fmtMoney(res.cashOut)}`)
        loadCash()
      } else {
        message.success('已更新')
      }
      load()
    } catch (e: unknown) {
      const error = e as { response?: { data?: { message?: string } } }
      message.error(error.response?.data?.message || '操作失败')
    }
  }

  const doRemove = async (id: number) => {
    try {
      await client.delete(`/commissions/${id}`)
      message.success('已删除')
      load()
      loadCash()
    } catch (e: any) {
      message.error(e.response?.data?.message || '删除失败')
    }
  }

  const settlementChannelFilters = useMemo(
    () => uniqueFilters(data.items, (r) => r.channelNameSnapshot),
    [data.items],
  )
  const settlementFundModeFilters = useMemo(
    () => uniqueFilters(data.items, (r) => r.fundSettlementMode, (r) => FUND_MODE_LABEL[r.fundSettlementMode] || r.fundSettlementMode),
    [data.items],
  )
  const settlementCurrencyFilters = useMemo(
    () => uniqueFilters(data.items, (r) => r.currency, (r) => CURRENCY_LABEL[r.currency] || r.currency),
    [data.items],
  )
  const cashChannelFilters = useMemo(
    () => uniqueFilters(cashData.items, (r) => r.channelName),
    [cashData.items],
  )
  const cashRebateStatusFilters = useMemo(
    () => uniqueFilters(cashData.items, (r) => r.rebateStatus),
    [cashData.items],
  )
  const cashFundModeFilters = useMemo(
    () => uniqueFilters(cashData.items, (r) => r.fundSettlementMode, (r) => FUND_MODE_LABEL[r.fundSettlementMode] || r.fundSettlementMode),
    [cashData.items],
  )
  const cashCurrencyFilters = useMemo(
    () => uniqueFilters(cashData.items, (r) => r.currency, (r) => CURRENCY_LABEL[r.currency] || r.currency),
    [cashData.items],
  )

  const settlementTable = (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="状态筛选"
          style={{ width: 160 }}
          value={status}
          onChange={setStatus}
          options={Object.entries(COMMISSION_STATUS_LABEL).map(([k, v]) => ({ value: k, label: v }))}
        />
      </Space>
      <Table
        {...scrollTableProps}
        className="settlement-list-table full-height-list-table"
        rowKey="recordKey"
        loading={loading}
        dataSource={data.items}
        columns={[
          { title: '客户', width: COL.person, render: (_, r) => r.customer?.name },
          {
            title: '订单 / 收款',
            width: COL.no,
            render: (_, r) => (
              <div>
                <div>{r.order?.orderNo}</div>
                {r.paymentId && (
                  <div style={{ color: '#6b7280', fontSize: 12 }}>
                    {r.paymentRemark || '分笔收款'} · {r.paymentNo}
                  </div>
                )}
              </div>
            ),
          },
          {
            title: '渠道(快照)',
            dataIndex: 'channelNameSnapshot',
            width: COL.channel,
            filters: settlementChannelFilters,
            filterSearch: true,
            onFilter: (value: any, r) => filterValue(r.channelNameSnapshot) === value,
          },
          {
            title: '资金模式',
            dataIndex: 'fundSettlementMode',
            width: COL.mode,
            filters: settlementFundModeFilters,
            onFilter: (value: any, r) => filterValue(r.fundSettlementMode) === value,
            render: (m) => FUND_MODE_LABEL[m],
          },
          {
            title: '币种',
            dataIndex: 'currency',
            width: COL.currency,
            filters: settlementCurrencyFilters,
            onFilter: (value: any, r) => filterValue(r.currency) === value,
            render: (c: string) => CURRENCY_LABEL[c] || c,
          },
          { title: '应付', dataIndex: 'payableAmount', width: COL.money, render: fmtMoney, align: 'right' },
          { title: '已付', dataIndex: 'paidAmount', width: COL.money, render: fmtMoney, align: 'right' },
          {
            title: '状态',
            width: COL.status,
            render: (_, r) => (
              <Space>
                <Tag color={COMMISSION_STATUS_COLOR[r.status]}>{COMMISSION_STATUS_LABEL[r.status]}</Tag>
                {r.suspended && <Tag color="red">挂起</Tag>}
              </Space>
            ),
          },
          {
            title: '操作',
            width: COL.actionWide,
            render: (_, r) => {
              if (isSelfDeducted(r)) return <Tag color="default">已自扣(报表)</Tag>

              if (r.isPaymentInstallment) {
                const parentIsFinal = FINAL_STATUS.includes(r.parentStatus)
                const showParentActions = r.installmentIndex === 0 && !parentIsFinal
                return (
                  <Space wrap>
                    {canConfirmPayment(r) && <ActionBtn tone="confirm" onClick={() => act(r, 'pay')}>确认支付</ActionBtn>}
                    {r.status === 'NOT_DUE' && <Tag>待对应收款到账</Tag>}
                    {r.status === 'PAID' && <Tag color="success">该笔已支付</Tag>}
                    {showParentActions &&
                      (r.suspended ? (
                        <ActionBtn tone="confirm" onClick={() => act(r, 'resume')}>解除挂起</ActionBtn>
                      ) : (
                        <ActionBtn tone="reject" onClick={() => act(r, 'suspend')}>挂起</ActionBtn>
                      ))}
                    {showParentActions && (
                      <ActionBtn
                        tone="reject"
                        onClick={() =>
                          Modal.confirm({ title: '确认取消该订单的全部分笔返佣？', onOk: () => act(r, 'cancel') })
                        }
                      >
                        取消
                      </ActionBtn>
                    )}
                    {showParentActions && <DeleteBtn onConfirm={() => doRemove(r.id)} />}
                  </Space>
                )
              }

              return (
                <Space wrap>
                  {canConfirmPayment(r) && <ActionBtn tone="confirm" onClick={() => act(r, 'pay')}>确认支付</ActionBtn>}
                  {!FINAL_STATUS.includes(r.status) &&
                    (r.suspended ? (
                      <ActionBtn tone="confirm" onClick={() => act(r, 'resume')}>解除挂起</ActionBtn>
                    ) : (
                      <ActionBtn tone="reject" onClick={() => act(r, 'suspend')}>挂起</ActionBtn>
                    ))}
                  {!FINAL_STATUS.includes(r.status) && (
                    <ActionBtn
                      tone="reject"
                      onClick={() =>
                        Modal.confirm({ title: '确认取消该分成？', onOk: () => act(r, 'cancel') })
                      }
                    >
                      取消
                    </ActionBtn>
                  )}
                  <DeleteBtn onConfirm={() => doRemove(r.id)} />
                </Space>
              )
            },
          },
        ]}
      />
    </>
  )

  const cashTable = (
    <Table
      {...scrollTableProps}
      className="cash-accounts-table full-height-list-table"
      rowKey="orderId"
      loading={cashLoading}
      dataSource={cashData.items}
      columns={[
        { title: '客户名称', dataIndex: 'customerName', width: COL.person },
        {
          title: '渠道',
          dataIndex: 'channelName',
          width: COL.channel,
          filters: cashChannelFilters,
          filterSearch: true,
          onFilter: (value: any, r) => filterValue(r.channelName) === value,
        },
        {
          title: '返佣状态',
          dataIndex: 'rebateStatus',
          width: COL.status,
          filters: cashRebateStatusFilters,
          onFilter: (value: any, r) => filterValue(r.rebateStatus) === value,
          render: (s: string) => <Tag color={REBATE_STATUS_COLOR[s]}>{s}</Tag>,
        },
        {
          title: '资金模式',
          dataIndex: 'fundSettlementMode',
          width: COL.mode,
          filters: cashFundModeFilters,
          onFilter: (value: any, r) => filterValue(r.fundSettlementMode) === value,
          render: (m: string) => FUND_MODE_LABEL[m],
        },
        {
          title: '币种',
          dataIndex: 'currency',
          width: COL.currency,
          filters: cashCurrencyFilters,
          onFilter: (value: any, r) => filterValue(r.currency) === value,
          render: (c: string) => CURRENCY_LABEL[c] || c,
        },
        { title: '合同金额', dataIndex: 'contractAmount', width: COL.money, render: fmtMoney, align: 'right' },
        { title: '实际入账', dataIndex: 'actualReceived', width: COL.money, render: fmtMoney, align: 'right' },
        { title: '当前结余', dataIndex: 'balance', width: COL.money, render: fmtMoney, align: 'right' },
      ]}
    />
  )

  return (
    <Tabs
      items={[
        { key: 'cash', label: '现金账目', children: cashTable },
        { key: 'settlement', label: '分成结算', children: settlementTable },
      ]}
    />
  )
}
