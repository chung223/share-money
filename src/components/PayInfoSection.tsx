import { useStore } from '../store'

import { APP_LINK_PLACEHOLDERS, APP_LINK_PRESETS, QUICK_PAY } from '../lib/twqr'
import { uid } from '../store'
import { useState } from 'react'

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
  const [advanced, setAdvanced] = useState(false)
  const links = payInfo.appLinks ?? []
  const setLinks = (next: { id: string; label: string; template: string }[]) => update((d) => (d.payInfo = { ...(d.payInfo ?? {}), appLinks: next }))
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
        const list = payInfo.quickPay ?? ['jkopay', 'linepay']
        const on = list.includes(q.id)
        return (
          <label key={q.id} className="row gap-s center small">
            <input type="checkbox" checked={on} onChange={(e) => update((d) => (d.payInfo = { ...(d.payInfo ?? {}), quickPay: e.target.checked ? [...list, q.id] : list.filter((x) => x !== q.id) }))} />
            {q.emoji} 一鍵打開 {q.label}（金額先複製，App 本身不支援帶金額轉帳）
          </label>
        )
      })}
      <button type="button" className="link small" onClick={() => setAdvanced((v) => !v)}>
        {advanced ? '收起' : '🔧 進階：自訂轉帳 App 連結'}
      </button>
      {advanced && (
        <div className="stack-s">
          <p className="muted small">
            各家 App 沒有公開「帶金額轉帳」的連結規格，但如果你自己挖到了（Android 可用 Shortcut Maker / App Manager 看 App 的 activity 與 URI；iOS 看 IPA 的 Info.plist），可以填在這裡，分享頁會多一顆按鈕。佔位符：{APP_LINK_PLACEHOLDERS.join(' ')}
          </p>
          {links.map((l, i) => (
            <div key={l.id} className="stack-xs card">
              <div className="row gap">
                <input className="input grow" placeholder="按鈕名稱，例：CUBE 轉帳" value={l.label} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <button type="button" className="icon-btn icon-btn--sm" aria-label="刪除" onClick={() => setLinks(links.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
              <input className="input input--expr" placeholder="myapp://transfer?acct={account}&amt={amount}" value={l.template} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, template: e.target.value } : x)))} />
            </div>
          ))}
          <div className="chip-row">
            {APP_LINK_PRESETS.map((p) => (
              <button key={p.label} type="button" className="chip chip--xs" onClick={() => setLinks([...links, { id: uid(), label: p.label, template: p.template }])}>
                ＋ {p.label}
              </button>
            ))}
            <button type="button" className="chip chip--xs" onClick={() => setLinks([...links, { id: uid(), label: '', template: '' }])}>
              ＋ 自訂
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
