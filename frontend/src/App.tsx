import { Routes, Route, Navigate } from 'react-router-dom'
import { Component, lazy, Suspense, type ReactNode } from 'react'
import { useAuth } from './auth/AuthContext'
import { inPortal } from './portal'

const Login = lazy(() => import('./pages/Login'))
const AppLayout = lazy(() => import('./layout/AppLayout'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Customers = lazy(() => import('./pages/Customers'))
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'))
const Channels = lazy(() => import('./pages/Channels'))
const Products = lazy(() => import('./pages/Products'))
const Orders = lazy(() => import('./pages/Orders'))
const OrderDetail = lazy(() => import('./pages/OrderDetail'))
const PaymentsAndRefunds = lazy(() => import('./pages/PaymentsAndRefunds'))
const Commissions = lazy(() => import('./pages/Commissions'))
const Reports = lazy(() => import('./pages/Reports'))
const Users = lazy(() => import('./pages/Users'))
const AuditLogs = lazy(() => import('./pages/AuditLogs'))

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{ padding: 32, color: '#334155' }}>
        <p>页面资源已更新，请刷新后继续使用。</p>
        <button type="button" onClick={() => window.location.reload()}>
          刷新页面
        </button>
      </div>
    )
  }
}

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<div style={{ padding: 24, color: '#64748b' }}>页面加载中…</div>}>
        <Routes>
          <Route path="/login" element={inPortal ? <Navigate to="/" replace /> : <Login />} />
          <Route
            path="/"
            element={
              <Protected>
                <AppLayout />
              </Protected>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="customers" element={<Customers />} />
            <Route path="customers/:id" element={<CustomerDetail />} />
            <Route path="channels" element={<Channels />} />
            <Route path="products" element={<Products />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/:id" element={<OrderDetail />} />
            <Route path="payments" element={<PaymentsAndRefunds />} />
            <Route path="refunds" element={<Navigate to="/payments?tab=refunds" replace />} />
            <Route path="commissions" element={<Commissions />} />
            <Route path="referrals" element={<Navigate to="/" replace />} />
            <Route path="reports" element={<Reports />} />
            <Route path="users" element={<Users />} />
            <Route path="audit-logs" element={<AuditLogs />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  )
}
