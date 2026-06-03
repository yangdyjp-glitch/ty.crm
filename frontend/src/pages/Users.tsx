import { useEffect, useState } from 'react'
import { Button, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd'
import client from '../api/client'
import { ROLE_LABEL } from '../api/types'
import { ActionBtn, DeleteBtn } from '../components/Actions'

type Any = Record<string, any>

export default function Users() {
  const [rows, setRows] = useState<Any[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editing, setEditing] = useState<Any | null>(null)
  const [form] = Form.useForm()

  const load = () => {
    setLoading(true)
    client.get('/users').then((r) => setRows(r.data)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openForm = (rec?: Any) => {
    setEditing(rec || null)
    form.resetFields()
    if (rec) form.setFieldsValue(rec)
    setOpen(true)
  }
  const submit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      if (editing) await client.patch(`/users/${editing.id}`, v)
      else await client.post('/users', v)
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
      await client.delete(`/users/${id}`)
      message.success('已删除')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.message || '删除失败')
    }
  }

  return (
    <div>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={() => openForm()}>新增用户</Button>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '用户编号', render: (_: any, r: Any) => 'YH' + String(r.id).padStart(6, '0') },
          { title: '账号', dataIndex: 'username' },
          { title: '姓名', dataIndex: 'name' },
          { title: '角色', dataIndex: 'role', render: (r) => <Tag color="blue">{ROLE_LABEL[r]}</Tag> },
          { title: '状态', dataIndex: 'status', render: (s) => <Tag color={s === 'active' ? 'green' : 'red'}>{s === 'active' ? '启用' : '停用'}</Tag> },
          {
            title: '操作',
            render: (_, r) => (
              <Space wrap>
                <ActionBtn tone="edit" onClick={() => openForm(r)}>编辑</ActionBtn>
                <DeleteBtn onConfirm={() => del(r.id)} />
              </Space>
            ),
          },
        ]}
      />
      <Modal title={editing ? '编辑用户' : '新增用户'} open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={submitting} okText={submitting ? '处理中…' : '确定'} maskClosable={false} cancelButtonProps={{ disabled: submitting }} destroyOnClose>
        <Form form={form} layout="vertical">
          {!editing && (
            <Form.Item name="username" label="账号" rules={[{ required: true }]}><Input /></Form.Item>
          )}
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="password" label={editing ? '重置密码（留空不改）' : '密码'} rules={editing ? [] : [{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={Object.entries(ROLE_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          {editing && (
            <Form.Item name="status" label="状态">
              <Select options={[{ value: 'active', label: '启用' }, { value: 'disabled', label: '停用' }]} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  )
}
