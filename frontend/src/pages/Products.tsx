import { useEffect, useState } from 'react'
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from 'antd'
import client from '../api/client'
import { CURRENCY_LABEL, fmtMoney } from '../api/types'
import { ActionBtn, DeleteBtn } from '../components/Actions'
import { COL, scrollTableProps } from '../components/tableLayout'

type Any = Record<string, any>

export default function Products() {
  const [rows, setRows] = useState<Any[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editing, setEditing] = useState<Any | null>(null)
  const [form] = Form.useForm()

  const load = () => {
    setLoading(true)
    client.get('/products', { params: { all: 1 } }).then((r) => setRows(r.data)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openForm = (rec?: Any) => {
    setEditing(rec || null)
    form.resetFields()
    if (rec) form.setFieldsValue({ ...rec, standardPrice: rec.standardPrice != null ? Number(rec.standardPrice) : undefined })
    else form.setFieldsValue({ currency: 'JPY', participateCommission: true, allowDiscount: true })
    setOpen(true)
  }
  const submit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      if (editing) await client.patch(`/products/${editing.id}`, v)
      else await client.post('/products', v)
      message.success('已保存')
      setOpen(false)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '操作失败')
    } finally {
      setSubmitting(false)
    }
  }
  const del = async (id: number) => {
    try {
      await client.delete(`/products/${id}`)
      message.success('已删除')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '删除失败')
    }
  }

  return (
    <div>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={() => openForm()}>新增项目</Button>
      <Table
        {...scrollTableProps}
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '项目名称', dataIndex: 'name', width: COL.project },
          { title: '分类', dataIndex: 'category', width: COL.type },
          { title: '标准价', dataIndex: 'standardPrice', width: COL.money, render: fmtMoney, align: 'right' },
          { title: '币种', dataIndex: 'currency', width: COL.currency, render: (c) => CURRENCY_LABEL[c] },
          { title: '参与分成', dataIndex: 'participateCommission', width: COL.status, render: (b) => (b ? '是' : '否') },
          { title: '状态', dataIndex: 'status', width: COL.status, render: (s) => <Tag color={s === 'active' ? 'green' : 'default'}>{s === 'active' ? '启用' : '停用'}</Tag> },
          {
            title: '操作',
            width: COL.action,
            render: (_, r) => (
              <Space wrap>
                <ActionBtn tone="edit" onClick={() => openForm(r)}>编辑</ActionBtn>
                <DeleteBtn onConfirm={() => del(r.id)} />
              </Space>
            ),
          },
        ]}
      />
      <Modal title={editing ? '编辑项目' : '新增项目'} open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={submitting} okText={submitting ? '处理中…' : '确定'} maskClosable={false} cancelButtonProps={{ disabled: submitting }} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="项目名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="category" label="分类"><Input /></Form.Item>
          <Form.Item name="standardPrice" label="标准价格" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="currency" label="币种" rules={[{ required: true }]}>
            <Select options={[{ value: 'JPY', label: '日元' }, { value: 'CNY', label: '人民币' }]} />
          </Form.Item>
          <Form.Item name="participateCommission" label="参与渠道分成" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="allowDiscount" label="允许优惠" valuePropName="checked"><Switch /></Form.Item>
          {editing && (
            <Form.Item name="status" label="状态">
              <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  )
}
