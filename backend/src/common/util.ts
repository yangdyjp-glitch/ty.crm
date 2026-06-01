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

/** Prisma Decimal -> number（用于返回给前端） */
export function dec(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return Number(v as never);
}
