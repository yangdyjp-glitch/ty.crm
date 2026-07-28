import { useEffect, useState } from 'react'
import { Button, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd'
import client from '../api/client'
import { ActionBtn, DeleteBtn } from '../components/Actions'
import { COL, pageTableProps } from '../components/tableLayout'
import {
  COMMISSION_STATUS_COLOR,
  COMMISSION_STATUS_LABEL,
  CURRENCY_LABEL,
  FUND_MODE_LABEL,
  fmtMoney,
} from '../api/types'

type Any = Record<string, any>

const CONFIRMABLE_STATUS = ['PENDING_REVIEW', 'PENDING_PAYMENT']
const FINAL_STATUS = ['PAID', 'CANCELLED', 'SELF_DEDUCTED']
const REBATE_STATUS_COLOR: Record<string, string> = {
  未到账: 'default',
  已自扣: 'blue',
  未返佣: 'orange',
  已返佣: 'green',
  无返佣: 'default',
}
const isSelfDeducted = (r: Any) =>
  r.fundSettlementMode === 'AGENT_NET' || r.status === 'SELF_DEDUCTED'

const canConfirmPayment = (r: Any) =>
  r.fundSettlementMode === 'COMPANY_REBATE' &&
  CONFIRMABLE_STATUS.includes(r.status) &&
  !r.suspended

export default function Commissions() {
  const [data, setData] = useState<{ items: Any[]; total: number }>({ items: [], total: 0 })
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [cashData, setCashData] = useState<{ items: Any[]; total: number }>({ items: [], total: 0 })
  const [cashPage, setCashPage] = useState(1)
  const [cashLoading, setCashLoading] = useState(false)

  const batch = async () => {
    if (!selected.length) return
    const { data: res } = await client.post('/commissions/batch-pay', { ids: selected })
    message.success(`已确认支付 ${res.paid}/${res.total}`)
    setSelected([])
    load()
    loadCash()
  }

  const load = () => {
    setLoading(true)
    client.get('/commissions', { params: { page, pageSize: 10, status } }).then((r) => setData(r.data)).finally(() => setLoading(false))
  }

  const loadCash = () => {
    setCashLoading(true)
    client.get('/commissions/cash-accounts', { params: { page: cashPage, pageSize: 10 } }).then((r) => setCashData(r.data)).finally(() => setCashLoading(false))
  }

  useEffect(load, [page, status])
  useEffect(loadCash, [cashPage])

  const act = async (id: number, action: string) => {
    const { data: res } = await client.post(`/commissions/${id}/${action}`)
    if (action === 'pay') {
      message.success(`已确认支付：应付 ${fmtMoney(res.payable)}，往来抵扣 ${fmtMoney(res.offset)}，实付现金 ${fmtMoney(res.cashOut)}`)
      loadCash()
    } else {
      message.success('已更新')
    }
    load()
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

  const settlementTable = (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="状态筛选"
          style={{ width: 160 }}
          value={status}
          onChange={(v) => { setPage(1); setStatus(v) }}
          options={Object.entries(COMMISSION_STATUS_LABEL).map(([k, v]) => ({ value: k, label: v }))}
        />
        <Button type="primary" disabled={!selected.length} onClick={batch}>批量确认支付（{selected.length}）</Button>
      </Space>
      <Table
        {...pageTableProps}
        rowKey="id"
        loading={loading}
        dataSource={data.items}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (k) => setSelected(k as number[]),
          getCheckboxProps: (r: Any) => ({
            disabled: !canConfirmPayment(r),
          }),
        }}
        pagination={{ current: page, pageSize: 10, total: data.total, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: '客户', width: COL.person, render: (_, r) => r.customer?.name },
          { title: '订单', width: COL.no, render: (_, r) => r.order?.orderNo },
          { title: '渠道(快照)', dataIndex: 'channelNameSnapshot', width: COL.channel },
          { title: '资金模式', dataIndex: 'fundSettlementMode', width: COL.mode, render: (m) => FUND_MODE_LABEL[m] },
          { title: '币种', dataIndex: 'currency', width: COL.currency, render: (c: string) => CURRENCY_LABEL[c] || c },
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

              return (
                <Space wrap>
                  {canConfirmPayment(r) && <ActionBtn tone="confirm" onClick={() => act(r.id, 'pay')}>确认支付</ActionBtn>}
                  {!FINAL_STATUS.includes(r.status) &&
                    (r.suspended ? (
                      <ActionBtn tone="confirm" onClick={() => act(r.id, 'resume')}>解除挂起</ActionBtn>
                    ) : (
                      <ActionBtn tone="reject" onClick={() => act(r.id, 'suspend')}>挂起</ActionBtn>
                    ))}
                  {!FINAL_STATUS.includes(r.status) && (
                    <ActionBtn
                      tone="reject"
                      onClick={() =>
                        Modal.confirm({ title: '确认取消该分成？', onOk: () => act(r.id, 'cancel') })
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
      {...pageTableProps}
      rowKey="orderId"
      loading={cashLoading}
      dataSource={cashData.items}
      pagination={{ current: cashPage, pageSize: 10, total: cashData.total, onChange: setCashPage, showSizeChanger: false }}
      columns={[
        { title: '客户名称', dataIndex: 'customerName', width: COL.person },
        { title: '渠道', dataIndex: 'channelName', width: COL.channel },
        {
          title: '返佣状态',
          dataIndex: 'rebateStatus',
          width: COL.status,
          render: (s: string) => <Tag color={REBATE_STATUS_COLOR[s]}>{s}</Tag>,
        },
        { title: '资金模式', dataIndex: 'fundSettlementMode', width: COL.mode, render: (m: string) => FUND_MODE_LABEL[m] },
        { title: '币种', dataIndex: 'currency', width: COL.currency, render: (c: string) => CURRENCY_LABEL[c] || c },
        { title: '合同金额', dataIndex: 'contractAmount', width: COL.money, render: fmtMoney, align: 'right' },
        { title: '实际入账', dataIndex: 'actualReceived', width: COL.money, render: fmtMoney, align: 'right' },
        { title: '当前结余', dataIndex: 'balance', width: COL.money, render: fmtMoney, align: 'right' },
      ]}
    />
  )

  return (
    <Tabs
      items={[
        { key: 'settlement', label: '分成结算', children: settlementTable },
        { key: 'cash', label: '现金账目', children: cashTable },
      ]}
    />
  )
}
