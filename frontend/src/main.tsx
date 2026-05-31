import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import './index.css'
import App from './App'
import { AuthProvider } from './auth/AuthContext'

const FONT = "'NumTNR', var(--font-serif)"

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#3b5bf6',
          colorInfo: '#7c3aed',
          colorSuccess: '#10b981',
          colorWarning: '#f59e0b',
          colorError: '#ef4444',
          colorLink: '#3b5bf6',
          borderRadius: 0,
          fontFamily: FONT,
          fontSize: 14,
          colorBorder: '#d4bb63',
          colorBorderSecondary: '#e9dcab',
          colorTextHeading: '#0f172a',
          colorText: '#1e2433',
          colorBgLayout: '#e9f5ec',
        },
        components: {
          Layout: {
            headerBg: 'transparent',
            siderBg: '#3b5bf6',
            bodyBg: '#e9f5ec',
            headerHeight: 56,
          },
          Card: { headerFontSize: 16 },
          Table: {
            headerBg: '#eef0ff',
            headerColor: '#4338ca',
            borderColor: '#e9dcab',
            cellFontSize: 14,
            rowHoverBg: '#f3f4ff',
          },
          Statistic: { contentFontSize: 30, titleFontSize: 14 },
          Menu: {
            itemHeight: 46,
            fontSize: 14,
            itemMarginInline: 8,
            darkItemBg: 'transparent',
            darkSubMenuItemBg: 'transparent',
            darkItemColor: 'rgba(255,255,255,0.78)',
            darkItemHoverBg: 'rgba(255,255,255,0.14)',
            darkItemHoverColor: '#ffffff',
            darkItemSelectedBg: 'rgba(255,255,255,0.22)',
            darkItemSelectedColor: '#ffffff',
          },
          Button: {
            fontWeight: 500,
            colorPrimary: '#1e40af',
            colorPrimaryHover: '#2952c8',
            colorPrimaryActive: '#163172',
            primaryShadow: 'none',
          },
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
