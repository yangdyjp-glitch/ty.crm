import { Button, Popconfirm } from 'antd'
import type { ButtonProps } from 'antd'
import type { ReactNode } from 'react'

/**
 * 操作列统一按钮：直角小按钮，按功能配色。
 * tone:
 *  - view    查看/详情/台账/明细  → 蓝
 *  - edit    编辑/修改/重命名/指派/快改 → 金棕
 *  - confirm 确认/审核/通过/支付/结算/启用/恢复 → 绿
 *  - reject  拒绝/停用/挂起/取消 → 红
 *  - delete  删除 → 浅灰（恒定）
 */
export type ActionTone = 'view' | 'edit' | 'confirm' | 'reject' | 'delete'

export function ActionBtn({
  tone = 'view',
  className = '',
  ...rest
}: Omit<ButtonProps, 'size' | 'type'> & { tone?: ActionTone }) {
  return <Button size="small" className={`act-btn act-${tone} ${className}`} {...rest} />
}

/** 删除按钮：恒定浅灰 + 二次确认。删除不可撤销。 */
export function DeleteBtn({
  onConfirm,
  disabled,
  title = '确认删除？此操作不可撤销',
  children = '删除',
}: {
  onConfirm: () => void
  disabled?: boolean
  title?: ReactNode
  children?: ReactNode
}) {
  if (disabled) {
    return (
      <ActionBtn tone="delete" disabled>
        {children}
      </ActionBtn>
    )
  }
  return (
    <Popconfirm
      title={title}
      okText="删除"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      onConfirm={onConfirm}
    >
      <ActionBtn tone="delete">{children}</ActionBtn>
    </Popconfirm>
  )
}
