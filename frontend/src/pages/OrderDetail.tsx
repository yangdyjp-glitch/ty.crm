import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Card, Form, Input, InputNumber, Space, Table, Tag, message } from 'antd'
import client from '../api/client'
import {
  CURRENCY_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_CONFIRM_LABEL,
  REFUND_STATUS_LABEL,
  fmtMoney,
} from '../api/types'
import { moneyIn, moneyOut } from '../api/money'

type Any = Record<string, any>

export default function OrderDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const [o, setO] = useState<Any | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = () => {
    client.get(`/orders/${id}`).then((r) => {
      setO(r.data)
      form.setFieldsValue({
        originalPrice: Number(r.data.originalPrice),
        discountAmount: Number(r.data.discountAmount),
        contractNo: r.data.contractNo,
        remark: r.data.remark,
      })
    })
  }
  useEffect(load, [id])

  const save = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      await client.patch(`/orders/${id}`, v)
      message.success('已保存')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!o) return null

  return (
    <div>
      <Button onClick={() => nav('/orders')} style={{ marginBottom: 12 }}>
        ← 返回订单列表
      </Button>
      <Card
        title={
          <Space wrap>
            订单 {o.orderNo}
            <Tag>{ORDER_STATUS_LABEL[o.status]}</Tag>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Form form={form} layout="vertical">
          <Space wrap size="large">
            <Form.Item label="客户">
              <Input value={`${o.customer?.name}（${o.customer?.customerNo}）`} disabled style={{ width: 240 }} />
            </Form.Item>
            <Form.Item label="项目">
              <Input value={o.product?.name} disabled style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="币种">
              <Input value={CURRENCY_LABEL[o.currency]} disabled style={{ width: 100 }} />
            </Form.Item>
          </Space>
          <Space wrap size="large">
            <Form.Item name="originalPrice" label="应缴金额" rules={[{ required: true }]}>
              <InputNumber min={0} controls={false} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="discountAmount" label="优惠">
              <InputNumber min={0} controls={false} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="contractNo" label="合同编号">
              <Input style={{ width: 180 }} />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ marginBottom: 12, color: '#6b7280' }}>
            应收 {fmtMoney(o.receivableAmount)} ｜ 已收 {fmtMoney(o.paidAmount)} ｜ 未收 {fmtMoney(o.unpaidAmount)} ｜ 退款 {fmtMoney(o.refundAmount)}
          </div>
          <Button type="primary" onClick={save} loading={saving}>
            保存
          </Button>
        </Form>
      </Card>

      <Card title="收款记录" size="small" style={{ marginBottom: 16 }}>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={o.payments || []}
          columns={[
            { title: '收款号', dataIndex: 'paymentNo' },
            { title: '金额', dataIndex: 'amount', render: moneyIn, align: 'right' },
            { title: '状态', dataIndex: 'confirmStatus', render: (s: string) => PAYMENT_CONFIRM_LABEL[s] },
            { title: '备注', dataIndex: 'remark' },
            { title: '', key: '__fill', render: () => null },
          ]}
        />
      </Card>

      <Card title="退款记录" size="small">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={o.refunds || []}
          columns={[
            { title: '退款号', dataIndex: 'refundNo' },
            { title: '名义额', dataIndex: 'nominalAmount', render: moneyOut, align: 'right' },
            { title: '状态', dataIndex: 'status', render: (s: string) => REFUND_STATUS_LABEL[s] },
            { title: '', key: '__fill', render: () => null },
          ]}
        />
      </Card>
    </div>
  )
}
