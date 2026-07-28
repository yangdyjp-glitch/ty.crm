/** 生成可读且唯一的业务编号：前缀 + base36 时间戳 + 2 位随机 */
export function genNo(prefix: string): string {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, '0');
  return `${prefix}${t}${r}`;
}

/**
 * 顺序业务编号：前缀 + 6 位数字（如 KH000001）。
 * 取该前缀下已有最大编号 +1；编号字段唯一，极端并发下靠唯一约束兜底。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function nextNo(delegate: any, field: string, prefix: string): Promise<string> {
  const last = await delegate.findFirst({
    where: { [field]: { startsWith: prefix } },
    orderBy: { [field]: 'desc' },
    select: { [field]: true },
  });
  const n = last && last[field] ? parseInt(String(last[field]).slice(prefix.length), 10) || 0 : 0;
  return prefix + String(n + 1).padStart(6, '0');
}

function customerNoDigits(customerNo: string): string {
  const match = /(\d+)$/.exec(customerNo);
  return (match?.[1] || '0').padStart(6, '0');
}

export function pairedNo(prefix: string, customerNo: string, sequence = 1): string {
  const base = prefix + customerNoDigits(customerNo);
  return sequence <= 1 ? base : `${base}-${String(sequence).padStart(2, '0')}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function nextPairedNo(
  delegate: any,
  field: string,
  prefix: string,
  customerNo: string,
  reserved: string[] = [],
): Promise<string> {
  const base = pairedNo(prefix, customerNo);
  const rows = await delegate.findMany({
    where: { OR: [{ [field]: base }, { [field]: { startsWith: `${base}-` } }] },
    select: { [field]: true },
  });
  const used = new Set([
    ...rows.map((row: Record<string, unknown>) => String(row[field])),
    ...reserved,
  ]);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = pairedNo(prefix, customerNo, i);
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`无法生成客户关联编号：${base}`);
}

/** Prisma Decimal -> number（用于返回给前端） */
export function dec(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return Number(v as never);
}
