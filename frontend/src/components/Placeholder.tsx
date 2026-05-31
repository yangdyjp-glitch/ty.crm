import { Empty } from 'antd'

export default function Placeholder({ title }: { title: string }) {
  return (
    <div style={{ padding: 48 }}>
      <Empty description={`${title}（建设中）`} />
    </div>
  )
}
