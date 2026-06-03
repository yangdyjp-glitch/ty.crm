import { useEffect, useState } from 'react'
import { Button, Modal, Select, Space, Table, Tag, message } from 'antd'
import client from '../api/client'
import { ActionBtn, DeleteBtn } from '../components/Actions'
import {
  COMMISSION_STATUS_COLOR,
  COMMISSION_STATUS_LABEL,
  CURRENCY_LABEL,
  FUND_MODE_LABEL,
  fmtMoney,
} from '../api/types'

type Any = Record<string, any>

export default function Commissions() {
  const [data, setData] = useState<{ items: Any[]; total: number }>({ items: [], total: 0 })
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<number[]>([])

  const batch = async (action: 'batch-review' | 'batch-pay') => {
    if (!selected.length) return
    const { data: res } = await client.post(`/commissions/${action}`, { ids: selected })
    message.success(`已结算 ${res.paid}/${res.total}`)
    setSelected([])
    load()
  }

  const load = () => {
    setLoading(true)
    client.get('/commissions', { params: { page, pageSize: 10, status } }).then((r) => setData(r.data)).finally(() => setLoading(false))
  }
  useEffect(load, [page, status])

  const act = async (id: number, action: string) => {
    const { data: res } = await client.post(`/commissions/${id}/${action}`)
    if (action === 'pay') {
      message.success(`已支付：应付 ${fmtMoney(res.payable)}，往来抵扣 ${fmtMoney(res.offset)}，实付现金 ${fmtMoney(res.cashOut)}`)
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
    } catch (e: any) {
      message.error(e.response?.data?.message || '删除失败')
    }
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="状态筛选"
          style={{ width: 160 }}
          value={status}
          onChange={(v) => { setPage(1); setStatus(v) }}
          options={Object.entries(COMMISSION_STATUS_LABEL).map(([k, v]) => ({ value: k, label: v }))}
        />
        <Button type="primary" disabled={!selected.length} onClick={() => batch('batch-pay')}>批量结算（{selected.length}）</Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data.items}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (k) => setSelected(k as number[]),
          getCheckboxProps: (r: Any) => ({
            disabled: !['PENDING_REVIEW', 'PENDING_PAYMENT'].includes(r.status) || r.suspended,
          }),
        }}
        pagination={{ current: page, pageSize: 10, total: data.total, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: '客户', width: 130, render: (_, r) => r.customer?.name },
          { title: '订单', width: 130, render: (_, r) => r.order?.orderNo },
          { title: '渠道(快照)', dataIndex: 'channelNameSnapshot', width: 130 },
          { title: '资金模式', dataIndex: 'fundSettlementMode', width: 120, render: (m) => FUND_MODE_LABEL[m] },
          { title: '币种', dataIndex: 'currency', width: 70, render: (c: string) => CURRENCY_LABEL[c] || c },
          { title: '应付', dataIndex: 'payableAmount', width: 120, render: fmtMoney, align: 'right' },
          { title: '已付', dataIndex: 'paidAmount', width: 120, render: fmtMoney, align: 'right' },
          {
            title: '状态',
            width: 130,
            render: (_, r) => (
              <Space>
                <Tag color={COMMISSION_STATUS_COLOR[r.status]}>{COMMISSION_STATUS_LABEL[r.status]}</Tag>
                {r.suspended && <Tag color="red">挂起</Tag>}
              </Space>
            ),
          },
          {
            title: '操作',
            width: 280,
            render: (_, r) => (
              <Space wrap>
                {['PENDING_REVIEW', 'PENDING_PAYMENT'].includes(r.status) && !r.suspended && <ActionBtn tone="confirm" onClick={() => act(r.id, 'pay')}>结算</ActionBtn>}
                {!['PAID', 'CANCELLED', 'SELF_DEDUCTED'].includes(r.status) &&
                  (r.suspended ? (
                    <ActionBtn tone="confirm" onClick={() => act(r.id, 'resume')}>解除挂起</ActionBtn>
                  ) : (
                    <ActionBtn tone="reject" onClick={() => act(r.id, 'suspend')}>挂起</ActionBtn>
                  ))}
                {!['PAID', 'CANCELLED', 'SELF_DEDUCTED'].includes(r.status) && (
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
            ),
          },
        ]}
      />
    </div>
  )
}
