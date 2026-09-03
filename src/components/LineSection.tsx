import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { lineApi, type LineStatus } from '../lib/line'

export default function LineSection() {
  const cfg = useStore((s) => s.data.sync)
  const showToast = useStore((s) => s.showToast)
  const [st, setSt] = useState<LineStatus | null | 'loading'>('loading')
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = () => lineApi.status().then(setSt).catch(() => setSt(null))
  useEffect(() => {
    refresh()
  }, [cfg?.secret])
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      if (ok) showToast(ok, '💚')
    } catch (e) {
      showToast(e instanceof Error ? e.message : '失敗了', '😵')
    } finally {
      setBusy(false)
      refresh()
    }
  }
  if (st !== 'loading' && st && !st.available) return null
  return (
    <section className="card stack">
      <div className="section-title">💚 LINE 機器人</div>
      <p className="muted small">在 LINE 直接把收據照片或一句話丟給 bot，打開 App 就變成帳本草稿。朋友按「我轉了」也能用 LINE 通知你。</p>
      {st === 'loading' ? (
        <p className="muted small">讀取中…</p>
      ) : !cfg || !st ? (
        <p className="small">要先開啟上面的多裝置同步。</p>
      ) : st.linked ? (
        <div className="stack-s">
          <div className="row gap wrap center">
            <span className="pill pill--mint">✅ 已連結 {st.displayName ? `LINE「${st.displayName}」` : ''}</span>
            {st.pending > 0 && <span className="pill pill--pink">收件匣 {st.pending} 筆</span>}
          </div>
          <label className="row gap-s center small">
            <input type="checkbox" checked={st.pushEnabled} disabled={busy} onChange={(e) => run(() => lineApi.setPush(e.target.checked))} />
            朋友按「我轉了」時用 LINE 通知我（會用到官方帳號的免費訊息額度）
          </label>
          <button type="button" className="btn btn--ghost btn--sm btn--danger-text center-self" disabled={busy} onClick={() => run(() => lineApi.unlink(), '已解除連結')}>
            解除連結
          </button>
        </div>
      ) : (
        <div className="stack-s">
          {code ? (
            <>
              <p className="small">
                1️⃣ 加 bot 好友　2️⃣ 傳這句給它（15 分鐘內）：
              </p>
              <code className="code-box">連結 {code}</code>
              <div className="row gap">
                <button type="button" className="btn btn--ghost grow" onClick={() => navigator.clipboard.writeText(`連結 ${code}`).then(() => showToast('已複製', '📋'))}>
                  📋 複製
                </button>
                <a className="btn btn--mint grow" href={`https://line.me/R/share?text=${encodeURIComponent(`連結 ${code}`)}`} target="_blank" rel="noreferrer">
                  💚 在 LINE 貼上
                </a>
              </div>
              <button type="button" className="link small" onClick={refresh}>
                傳好了，重新整理狀態
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(async () => setCode((await lineApi.linkCode()).code))}>
              產生連結碼
            </button>
          )}
        </div>
      )}
    </section>
  )
}
