/** 生成可读且唯一的业务编号：前缀 + base36 时间戳 + 2 位随机 */
export function genNo(prefix: string): string {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, '0');
  return `${prefix}${t}${r}`;
}

/** Prisma Decimal -> number（用于返回给前端） */
export function dec(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return Number(v as never);
}
