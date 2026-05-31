import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import './index.css'
import App from './App'
import { AuthProvider } from './auth/AuthContext'

const FONT =
  "'Noto Sans SC', -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          colorInfo: '#2563eb',
          colorSuccess: '#10b981',
          colorWarning: '#f59e0b',
          colorError: '#ef4444',
          colorLink: '#2563eb',
          borderRadius: 6,
          fontFamily: FONT,
          fontSize: 14,
          colorBorder: '#c3ccda',
          colorBorderSecondary: '#e6ebf2',
          colorTextHeading: '#0f172a',
          colorText: '#1e2433',
          colorBgLayout: '#eef2f7',
        },
        components: {
          Layout: {
            headerBg: '#ffffff',
            siderBg: '#ffffff',
            bodyBg: '#eef2f7',
            headerHeight: 56,
          },
          Card: { headerFontSize: 16 },
          Table: {
            headerBg: '#eaf1ff',
            headerColor: '#1e40af',
            borderColor: '#e6ebf2',
            cellFontSize: 14,
            rowHoverBg: '#f4f8ff',
          },
          Statistic: { contentFontSize: 30, titleFontSize: 14 },
          Menu: {
            itemHeight: 46,
            fontSize: 14,
            itemMarginInline: 8,
            darkItemBg: '#1e2433',
            darkSubMenuItemBg: '#1e2433',
            darkItemColor: '#c9d1dc',
            darkItemHoverBg: '#2a3344',
            darkItemHoverColor: '#ffffff',
            darkItemSelectedBg: '#2b3547',
            darkItemSelectedColor: '#ffffff',
          },
          Button: { fontWeight: 500 },
        },
      }}
    >
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ConfigProvider>
  </StrictMode>,
)
