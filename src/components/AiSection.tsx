import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { aiStatus, redeemAiCode, type AiStatus } from '../lib/ai'

export default function AiSection() {
  const cfg = useStore((s) => s.data.sync)
  const showToast = useStore((s) => s.showToast)
  const [st, setSt] = useState<AiStatus | null | 'loading'>('loading')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    aiStatus(true).then(setSt)
  }, [cfg?.secret])
  const redeem = async () => {
    setBusy(true)
    try {
      setSt(await redeemAiCode(code.trim()))
      showToast('AI 辨識開通了 ✨', '🎉')
      setCode('')
    } catch (e) {
      showToast(e instanceof Error ? e.message : '失敗', '😵')
    } finally {
      setBusy(false)
    }
  }
  if (st !== 'loading' && st && !st.available) return null // 伺服器沒開 AI 就不顯示
  return (
    <section className="card stack">
      <div className="section-title">✨ AI 收據辨識</div>
      <p className="muted small">把收據照片或亂七八糟的訂單文字丟給 AI，直接整理成品項。這會用到站長的 API 額度，所以要有邀請碼才能開。</p>
      {st === 'loading' ? (
        <p className="muted small">讀取中…</p>
      ) : !cfg || !st ? (
        <p className="small">要先開啟上面的多裝置同步（AI 額度是綁帳號算的）。</p>
      ) : st.allowed ? (
        <div className="row gap wrap center">
          <span className="pill pill--mint">✅ 已開通</span>
          <span className="muted small">
            今天用了 {st.used} / {st.quota} 次{st.remaining < st.quota - st.used ? '（全站額度快滿）' : ''}
          </span>
        </div>
      ) : (
        <div className="row gap">
          <input className="input grow" placeholder="邀請碼" value={code} onChange={(e) => setCode(e.target.value)} />
          <button type="button" className="btn btn--primary" disabled={busy || !code.trim()} onClick={redeem}>
            開通
          </button>
        </div>
      )}
      {st !== 'loading' && st && <p className="muted small">帳號 ID：{st.accountId}（站長開通時會用到）</p>}
    </section>
  )
}
