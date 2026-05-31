import { useEffect, useState } from 'react'
import { Badge, Dropdown, Empty, List, message } from 'antd'
import { BellOutlined } from '@ant-design/icons'
import client from '../api/client'
import { useAuth } from '../auth/AuthContext'

type Any = Record<string, any>

export default function NotificationBell() {
  const { user } = useAuth()
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<Any[]>([])
  const [open, setOpen] = useState(false)

  const loadCount = () =>
    client.get('/notifications/unread-count').then((r) => setCount(r.data.count)).catch(() => {})
  const loadList = () =>
    client.get('/notifications').then((r) => setItems(r.data)).catch(() => {})

  useEffect(() => {
    loadCount()
    const t = setInterval(loadCount, 60000)
    return () => clearInterval(t)
  }, [])

  const onOpen = (o: boolean) => {
    setOpen(o)
    if (o) loadList()
  }
  const readAll = async () => {
    await client.post('/notifications/read-all')
    loadCount()
    loadList()
  }
  const scan = async () => {
    const { data } = await client.post('/notifications/scan')
    message.success(`扫描完成：逾期${data.scanned.overdue}，待审核${data.scanned.pendingReview}，未缴${data.scanned.unpaid}`)
    loadCount()
    loadList()
  }

  const panel = (
    <div style={{ width: 340, background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.15)', borderRadius: 8, padding: 8, maxHeight: 420, overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px' }}>
        <b>通知</b>
        <span style={{ fontSize: 13 }}>
          {user?.role === 'ADMIN' && <a onClick={scan} style={{ marginRight: 12 }}>立即扫描</a>}
          <a onClick={readAll}>全部已读</a>
        </span>
      </div>
      {items.length ? (
        <List
          size="small"
          dataSource={items}
          renderItem={(n: Any) => (
            <List.Item style={{ opacity: n.isRead ? 0.45 : 1 }}>
              <Badge status={n.isRead ? 'default' : 'processing'} text={n.title} />
            </List.Item>
          )}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" />
      )}
    </div>
  )

  return (
    <Dropdown open={open} onOpenChange={onOpen} dropdownRender={() => panel} trigger={['click']}>
      <Badge count={count} size="small" style={{ marginRight: 24 }}>
        <BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} />
      </Badge>
    </Dropdown>
  )
}
