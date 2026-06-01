export default function PageHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  const t = new Date()
  const d = `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()}`
  return (
    <div style={{ borderBottom: '1px solid #d4bb63', paddingBottom: 9, marginBottom: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: 3, color: '#15803d', textTransform: 'uppercase', marginBottom: 4, fontWeight: 700 }}>
        {eyebrow}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 1, color: '#0f172a' }}>{title}</div>
        <div style={{ color: '#9aa3b2', fontSize: 13 }}>数据快照 · {d}</div>
      </div>
    </div>
  )
}
