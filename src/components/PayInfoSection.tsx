import { useStore } from '../store'

import { QUICK_PAY } from '../lib/twqr'

type TextKey = 'bankCode' | 'bankName' | 'account' | 'linePay' | 'note'
const FIELDS: { key: TextKey; label: string; placeholder: string; inputMode?: 'numeric' | 'url' }[] = [
  { key: 'bankCode', label: '銀行代碼', placeholder: '例：808', inputMode: 'numeric' },
  { key: 'bankName', label: '銀行名稱（選填）', placeholder: '例：玉山' },
  { key: 'account', label: '帳號', placeholder: '0000-000-000000', inputMode: 'numeric' },
  { key: 'linePay', label: 'LINE Pay / 街口 連結（選填）', placeholder: 'https://…', inputMode: 'url' },
  { key: 'note', label: '備註（選填）', placeholder: '例：轉完跟我說一聲～' },
]

export default function PayInfoSection() {
  const payInfo = useStore((s) => s.data.payInfo) ?? {}
  const update = useStore((s) => s.update)
  const setField = (k: TextKey, v: string) =>
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
      <div className="label">分享頁上的快捷方式</div>
      <label className="row gap-s center small">
        <input type="checkbox" checked={payInfo.showTwqr !== false} onChange={(e) => update((d) => (d.payInfo = { ...(d.payInfo ?? {}), showTwqr: e.target.checked }))} />
        🏦 銀行轉帳 QR（TWQR）：朋友用銀行 App / 台灣 Pay 掃，帳號金額自動帶入（需填銀行代碼＋帳號）
      </label>
      {QUICK_PAY.map((q) => {
        const list = payInfo.quickPay ?? ['linepay', 'jkopay']
        const on = list.includes(q.id)
        return (
          <label key={q.id} className="row gap-s center small">
            <input type="checkbox" checked={on} onChange={(e) => update((d) => (d.payInfo = { ...(d.payInfo ?? {}), quickPay: e.target.checked ? [...list, q.id] : list.filter((x) => x !== q.id) }))} />
            {q.emoji} 一鍵打開 {q.label}（金額先複製，App 本身不支援帶金額轉帳）
          </label>
        )
      })}
    </section>
  )
}
