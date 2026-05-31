import { fmtMoney } from './types'

/** 收款类金额 → 绿色 */
export const moneyIn = (v: unknown) => (
  <span style={{ color: '#16a34a' }}>{fmtMoney(v)}</span>
)

/** 退款类金额 → 红色 */
export const moneyOut = (v: unknown) => (
  <span style={{ color: '#dc2626' }}>{fmtMoney(v)}</span>
)
