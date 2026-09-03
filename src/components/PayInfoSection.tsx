import { useStore } from '../store'
import type { PayInfo } from '../lib/types'

const FIELDS: { key: keyof PayInfo; label: string; placeholder: string; inputMode?: 'numeric' | 'url' }[] = [
  { key: 'bankCode', label: '銀行代碼', placeholder: '例：808', inputMode: 'numeric' },
  { key: 'bankName', label: '銀行名稱（選填）', placeholder: '例：玉山' },
  { key: 'account', label: '帳號', placeholder: '0000-000-000000', inputMode: 'numeric' },
  { key: 'linePay', label: 'LINE Pay / 街口 連結（選填）', placeholder: 'https://…', inputMode: 'url' },
  { key: 'note', label: '備註（選填）', placeholder: '例：轉完跟我說一聲～' },
]

export default function PayInfoSection() {
  const payInfo = useStore((s) => s.data.payInfo) ?? {}
  const update = useStore((s) => s.update)
  const setField = (k: keyof PayInfo, v: string) =>
    update((d) => {
      d.payInfo = { ...(d.payInfo ?? {}), [k]: v }
    })
  return (
    <section className="card stack">
      <div className="section-title">💳 我的收款方式</div>
      <p className="muted small">會放在分享連結的頁面上，朋友看完自己的份就能直接轉給你。</p>
      {FIELDS.map((f) => (
        <label key={f.key} className="stack-xs">
          <span className="label">{f.label}</span>
          <input className="input" inputMode={f.inputMode} placeholder={f.placeholder} value={payInfo[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} />
        </label>
      ))}
    </section>
  )
}
