export const COL = {
  no: 118,
  shortNo: 104,
  name: 150,
  person: 130,
  contact: 220,
  source: 190,
  project: 180,
  channel: 190,
  company: 180,
  type: 116,
  method: 150,
  mode: 170,
  condition: 130,
  date: 120,
  datetime: 150,
  currency: 92,
  percent: 104,
  money: 128,
  count: 92,
  status: 118,
  action: 170,
  actionWide: 240,
  text: 220,
  note: 260,
} as const

export const pageTableProps = {
  tableLayout: 'fixed' as const,
  scroll: { x: 'max-content' as const },
}

export const smallTableProps = {
  ...pageTableProps,
  size: 'small' as const,
}
