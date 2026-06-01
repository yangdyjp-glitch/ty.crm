// 与后端枚举对应的中文标签

export const ROLE_LABEL: Record<string, string> = {
  MARKET: '市场',
  SALES: '销售',
  DOWNSTREAM_SALES: '下游销售',
  ADMIN: '管理员',
};

export const CURRENCY_LABEL: Record<string, string> = { CNY: '人民币', JPY: '日元' };

export const SOURCE_LABEL: Record<string, string> = {
  SELF: '自获取',
  INDIVIDUAL_THIRD_PARTY: '个人',
  ENTERPRISE_THIRD_PARTY: '企业',
};

export const CHANNEL_TYPE_LABEL: Record<string, string> = {
  INDIVIDUAL: '个人',
  ENTERPRISE: '企业',
};

export const FUND_MODE_LABEL: Record<string, string> = {
  AGENT_NET: '第三方代收·净额',
  COMPANY_REBATE: '公司代收·返佣',
};

export const COMMISSION_METHOD_LABEL: Record<string, string> = {
  NET_RECEIVED_RATIO: '按实收比例',
  FIXED_AMOUNT: '固定金额',
};

export const SETTLEMENT_COND_LABEL: Record<string, string> = {
  ON_SIGN: '签约后',
  ON_FULL_PAYMENT: '缴清后',
  ON_SERVICE_COMPLETE: '服务完成后',
  AFTER_REFUND_WINDOW: '过退款期后',
  MANUAL: '人工',
};

export const CUSTOMER_STATUS_LABEL: Record<string, string> = {
  NEW_LEAD: '新线索',
  FOLLOWING: '跟进中',
  SIGNED: '已签约',
  IN_SERVICE: '服务中',
  COMPLETED: '已完成服务',
  LOST: '已流失',
  REFUNDING: '退款中',
  REFUNDED: '已退款',
};

export const CUSTOMER_STATUS_COLOR: Record<string, string> = {
  NEW_LEAD: 'default',
  FOLLOWING: 'processing',
  SIGNED: 'cyan',
  IN_SERVICE: 'blue',
  COMPLETED: 'success',
  LOST: 'default',
  REFUNDING: 'orange',
  REFUNDED: 'red',
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: '待付款',
  PARTIAL_PAID: '部分付款',
  FULLY_PAID: '已缴清',
  IN_SERVICE: '服务中',
  COMPLETED: '已完成服务',
  REFUNDED: '已退款',
  CANCELLED: '已取消',
};

export const PAYMENT_CONFIRM_LABEL: Record<string, string> = {
  PENDING: '待确认',
  CONFIRMED: '已确认',
  PROBLEM: '有问题',
};

export const REFUND_REASON_LABEL: Record<string, string> = {
  SERVICE_FAILURE: '服务失败/不佳',
  CUSTOMER: '客户原因',
  VISA: '签证原因',
  APPLICATION_FAILED: '申请失败',
  OTHER: '其他',
};

export const REFUND_STATUS_LABEL: Record<string, string> = {
  PENDING: '待处理',
  REFUNDED: '已退款',
  REJECTED: '已拒绝',
  ABNORMAL: '异常',
};

export const REFUND_BEARER_LABEL: Record<string, string> = {
  COMPANY: '公司',
  THIRD_PARTY: '第三方',
};

export const COMMISSION_STATUS_LABEL: Record<string, string> = {
  SELF_DEDUCTED: '已自扣(报表)',
  NOT_DUE: '未到结算',
  PENDING_REVIEW: '待审核',
  PENDING_PAYMENT: '待支付',
  PAID: '已支付',
  CANCELLED: '已取消',
};

export const COMMISSION_STATUS_COLOR: Record<string, string> = {
  SELF_DEDUCTED: 'default',
  NOT_DUE: 'default',
  PENDING_REVIEW: 'orange',
  PENDING_PAYMENT: 'gold',
  PAID: 'success',
  CANCELLED: 'red',
};

export const INTENTION_LABEL: Record<string, string> = {
  A: 'A 高',
  B: 'B 中',
  C: 'C 低',
  D: 'D 流失',
};

export const REFERRAL_COLLECTION_LABEL: Record<string, string> = {
  PENDING: '待收款',
  COLLECTED: '已收款',
};

export const FOLLOW_METHOD_LABEL: Record<string, string> = {
  WECHAT: '微信',
  PHONE: '电话',
  EMAIL: '邮件',
  MEETING: '面谈',
  ONLINE: '线上会议',
  OTHER: '其他',
};

export const LEDGER_TYPE_LABEL: Record<string, string> = {
  MODE1_ADVANCE_REFUND: '模式一·第三方垫付退款',
  MODE2_ADVANCE_COMMISSION: '模式二·公司垫付佣金',
  NEW_ORDER_OFFSET: '新单抵扣',
  TRANSFER_TO_RECEIVABLE: '转应收·追现金',
  MANUAL_ADJUST: '人工调整',
}

export const SALES_STAGE_LABEL: Record<string, string> = {
  NOT_CONTACTED: '未联系',
  CONTACTED: '已联系',
  NEEDS_CONFIRMED: '需求确认',
  PROPOSAL: '方案介绍',
  PRICING: '价格沟通',
  CLOSING: '促单中',
  WON: '已成交',
  LOST: '未成交',
}

export const fmtMoney = (v: unknown) =>
  v == null ? '0' : Number(v).toLocaleString();
