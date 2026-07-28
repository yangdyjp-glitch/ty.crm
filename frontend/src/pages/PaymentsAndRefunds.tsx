import { Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import Payments from './Payments'
import Refunds from './Refunds'

export default function PaymentsAndRefunds() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeKey = searchParams.get('tab') === 'refunds' ? 'refunds' : 'payments'

  return (
    <Tabs
      activeKey={activeKey}
      onChange={(key) => setSearchParams(key === 'refunds' ? { tab: 'refunds' } : {})}
      items={[
        { key: 'payments', label: '收款', children: <Payments /> },
        { key: 'refunds', label: '退款', children: <Refunds /> },
      ]}
    />
  )
}

