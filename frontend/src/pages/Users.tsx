import { useEffect, useState } from 'react'
import { Button, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd'
import client from '../api/client'
import { apiErrorMessage } from '../api/errors'
import { ROLE_LABEL } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { ActionBtn, DeleteBtn } from '../components/Actions'
import { COL, pageTableProps } from '../components/tableLayout'
import { crmHome, inPortal } from '../portal'

type UserRow = {
  id: number
  username: string
  name: string
  role: string
  status: 'active' | 'disabled'
}

type UserForm = {
  username?: string
  name: string
  password?: string
  role: string
  status?: UserRow['status']
}

const fetchUsers = (signal?: AbortSignal) => client.get<UserRow[]>('/users', { signal })

export default function Users() {
  const { user, impersonate } = useAuth()
  const [rows, setRows] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [impersonatingId, setImpersonatingId] = useState<number | null>(null)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [form] = Form.useForm<UserForm>()

  const reload = () => {
    setLoading(true)
    setReloadKey((current) => current + 1)
  }
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    void fetchUsers(controller.signal)
      .then((response) => { if (active) setRows(response.data) })
      .catch((error: unknown) => { if (active) message.error(apiErrorMessage(error, '用户数据加载失败')) })
      .finally(() => { if (active) setLoading(false) })
    return () => {
      active = false
      controller.abort()
    }
  }, [reloadKey])

  const openForm = (rec?: UserRow) => {
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
      reload()
    } catch (error: unknown) {
      message.error(apiErrorMessage(error, '操作失败'))
    } finally {
      setSubmitting(false)
    }
  }
  const del = async (id: number) => {
    try {
      await client.delete(`/users/${id}`)
      message.success('已删除')
      reload()
    } catch (error: unknown) {
      message.error(apiErrorMessage(error, '删除失败'))
    }
  }
  const doImpersonate = (r: UserRow) => {
    Modal.confirm({
      title: `登录该账户：${r.name}`,
      content: (
        <div>
          <p>将以「{r.name}」的身份登录其账户，期间你看到和操作的都是该用户的内容。</p>
          <p>此操作会被记入审计日志，不会修改对方密码。完成后可点击顶部横幅「返回我的账户」。</p>
          <p>确定继续吗？</p>
        </div>
      ),
      okText: '登录该账户',
      cancelText: '取消',
      onOk: async () => {
        setImpersonatingId(r.id)
        try {
          await impersonate(r.id)
          window.location.assign(crmHome)
        } catch (error: unknown) {
          message.error(apiErrorMessage(error, '代理登录失败'))
          setImpersonatingId(null)
        }
      },
    })
  }

  return (
    <div>
      {inPortal
        ? <Button type="primary" style={{ marginBottom: 16 }} href="/admin">在 TYAI 管理账号和角色</Button>
        : <Button type="primary" style={{ marginBottom: 16 }} onClick={() => openForm()}>新增用户</Button>}
      <Table<UserRow>
        {...pageTableProps}
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '用户编号', width: COL.no, render: (_, r) => 'YH' + String(r.id).padStart(6, '0') },
          { title: '账号', dataIndex: 'username', width: COL.name },
          { title: '姓名', dataIndex: 'name', width: COL.person },
          { title: '角色', dataIndex: 'role', width: COL.status, render: (r) => <Tag color="blue">{ROLE_LABEL[r]}</Tag> },
          { title: '状态', dataIndex: 'status', width: COL.status, render: (s) => <Tag color={s === 'active' ? 'green' : 'red'}>{s === 'active' ? '启用' : '停用'}</Tag> },
          {
            title: '操作',
            width: COL.actionWide,
            render: (_, r) => (
              <Space wrap>
                {!inPortal && <ActionBtn tone="edit" onClick={() => openForm(r)}>编辑</ActionBtn>}
                {user?.role === 'ADMIN' && !user.impersonator && r.id !== user.id && r.status === 'active' && (
                  <ActionBtn tone="view" loading={impersonatingId === r.id} disabled={submitting || impersonatingId !== null} onClick={() => doImpersonate(r)}>
                    登录该账户
                  </ActionBtn>
                )}
                {!inPortal && <DeleteBtn onConfirm={() => del(r.id)} />}
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
