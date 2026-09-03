import { useState } from 'react'
import { useStore } from '../store'
import { SHARE_DURATIONS, shareUrl } from '../lib/share'
import type { Project } from '../lib/types'
import { Sheet } from './ui'
import { categoryOf } from '../lib/category'

export default function ShareLinkSheet({ p, open, onClose }: { p: Project; open: boolean; onClose: () => void }) {
  const createShare = useStore((s) => s.createShare)
  const revokeShare = useStore((s) => s.revokeShare)
  const hasSync = useStore((s) => !!s.data.sync)
  const payInfo = useStore((s) => s.data.payInfo)
  const showToast = useStore((s) => s.showToast)
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState(false)
  const share = p.share
  const url = share ? shareUrl(share.id, share.key) : null
  const expired = share ? share.expiresAt < Date.now() : false
  const hasPay = !!(payInfo?.account || payInfo?.linePay)

  const run = async (fn: () => Promise<unknown>, ok: string, emoji: string) => {
    setBusy(true)
    try {
      await fn()
      showToast(ok, emoji)
    } catch (e) {
      showToast(e instanceof Error ? e.message : '失敗了', '😵')
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!url) return
    const text = `${p.emoji} ${p.name || categoryOf(p).thisOne} 的分帳：${url}\n點進去看自己的份，轉完按「我轉了」就好～`
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        showToast('已複製連結，貼到群組吧', '📋')
      }
    } catch {
      /* cancelled */
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="🔗 給朋友的連結">
      <div className="stack">
        {!share || expired ? (
          <>
            <p className="muted small">朋友點開會看到自己那份和你的轉帳資訊，按「我轉了」你這邊就會自動打勾。連結內容有加密，伺服器看不到金額。</p>
            {!hasSync && <p className="small">第一次分享會自動開啟雲端同步（設定頁可以管理）。</p>}
            {!hasPay && <p className="small">💡 還沒填收款方式，朋友會不知道要轉去哪。可以先到設定頁填一下。</p>}
            <div className="label">連結有效期限</div>
            <div className="chip-row">
              {SHARE_DURATIONS.map((d) => (
                <button key={d.days} type="button" className={`chip ${days === d.days ? 'is-on' : ''}`} onClick={() => setDays(d.days)}>
                  {d.label}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => run(() => createShare(p.id, days), '連結產生好了', '🔗')}>
              {busy ? '產生中…' : '產生連結'}
            </button>
          </>
        ) : (
          <>
            <code className="code-box code-box--wrap">{url}</code>
            <p className="muted small center-text">到 {new Date(share.expiresAt).toLocaleDateString('zh-TW')} 為止有效 · 帳本有改會在同步時自動更新</p>
            <button type="button" className="btn btn--primary btn--lg" onClick={copy}>
              📤 分享連結
            </button>
            <div className="row gap wrap">
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => run(() => createShare(p.id, days), '延長好了', '⏰')}>
                延長 {days} 天
              </button>
              <button type="button" className="btn btn--ghost btn--danger-text" disabled={busy} onClick={() => run(() => revokeShare(p.id), '連結已停用', '🚫')}>
                停用連結
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
