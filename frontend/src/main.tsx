import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import './index.css'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { crmBase, inPortal } from './portal'

const FONT = "'NumTNR', var(--font-serif)"

const application = (
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#15803d',
          colorInfo: '#15803d',
          colorSuccess: '#10b981',
          colorWarning: '#f59e0b',
          colorError: '#ef4444',
          colorLink: '#15803d',
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
            siderBg: '#15803d',
            bodyBg: '#e9f5ec',
            headerHeight: 56,
          },
          Card: { headerFontSize: 16 },
          Form: { itemMarginBottom: 14 },
          Table: {
            headerBg: '#e3f3ea',
            headerColor: '#15603a',
            borderColor: '#e9dcab',
            cellFontSize: 14,
            cellPaddingBlock: 9,
            rowHoverBg: '#eef8f1',
          },
          Statistic: { contentFontSize: 30, titleFontSize: 14 },
          Menu: {
            itemHeight: 40,
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
            colorPrimary: '#166534',
            colorPrimaryHover: '#15803d',
            colorPrimaryActive: '#14532d',
            primaryShadow: 'none',
            borderRadius: 6,
            borderRadiusLG: 6,
            borderRadiusSM: 6,
          },
          Select: {
            borderRadius: 6,
            borderRadiusLG: 6,
            borderRadiusSM: 6,
          },
        },
      }}
    >
      <BrowserRouter basename={crmBase || '/'}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ConfigProvider>
  </StrictMode>
)

const portalOrigin = import.meta.env.VITE_TYAI_ORIGIN
if (!inPortal && portalOrigin) {
  const target = new URL('/crm' + window.location.pathname, portalOrigin)
  target.search = window.location.search
  target.hash = window.location.hash
  window.location.replace(target.href)
} else {
  createRoot(document.getElementById('root')!).render(application)
}
