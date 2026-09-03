import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { defaultOgTitle, SHARE_DURATIONS, shareUrl } from '../lib/share'
import { categoryOf } from '../lib/category'
import type { Project } from '../lib/types'
import { Mascot, Sheet } from './ui'

/** 給朋友的連結：產生、預覽（LINE 卡片長什麼樣）、延長、停用。 */
export default function ShareLinkSheet({ p, open, onClose }: { p: Project; open: boolean; onClose: () => void }) {
  const createShare = useStore((s) => s.createShare)
  const revokeShare = useStore((s) => s.revokeShare)
  const hasSync = useStore((s) => !!s.data.sync)
  const payInfo = useStore((s) => s.data.payInfo)
  const showToast = useStore((s) => s.showToast)
  const cat = categoryOf(p)
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState(false)
  const [showTitle, setShowTitle] = useState(true)
  const [title, setTitle] = useState('')
  const share = p.share
  const live = !!share && share.expiresAt > Date.now()
  const url = share ? shareUrl(share.id, share.key) : null
  const hasPay = !!(payInfo?.account || payInfo?.linePay)

  useEffect(() => {
    if (!open) return
    setShowTitle(share ? share.ogTitle !== null : true)
    setTitle(share?.ogTitle ?? defaultOgTitle(p, cat.unnamed))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, share?.id])

  const og = showTitle ? title.trim() || defaultOgTitle(p, cat.unnamed) : null
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
  const send = async () => {
    if (!url) return
    const text = `${og ?? `${p.emoji} ${cat.thisOne}的分帳`}\n看你的份、轉完按「我轉了」👉 ${url}`
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        showToast('已複製，貼到群組吧', '📋')
      }
    } catch {
      /* cancelled */
    }
  }
  const daysLeft = share ? Math.max(0, Math.ceil((share.expiresAt - Date.now()) / 86_400_000)) : 0

  const preview = (
    <div className="og-preview">
      <div className="og-preview__img">
        <Mascot size={54} mood="wow" />
        <div className="og-preview__imgtext">{og?.replace(/[\p{Extended_Pictographic}]/gu, '').trim() || '有人幫你先付了'}</div>
      </div>
      <div className="og-preview__body">
        <div className="strong">{og ?? '有人幫你先付了 💸'}</div>
        <div className="muted small">點開看自己的份，轉完按「我轉了」就好 💸</div>
        <div className="muted small">spilt.chung.men</div>
      </div>
    </div>
  )

  return (
    <Sheet open={open} onClose={onClose} title="🔗 給朋友的連結" tall>
      <div className="stack">
        {!live ? (
          <>
            <p className="muted small">朋友點開會看到自己那份和你的轉帳資訊，按「我轉了」你這邊就自動打勾。金額和名單都有加密，伺服器看不到。</p>
            {!hasSync && <p className="small">第一次分享會自動開啟雲端同步（設定頁可以管理）。</p>}
            {!hasPay && <p className="small">💡 還沒填收款方式，朋友會不知道要轉去哪。可以先到設定頁填一下。</p>}
          </>
        ) : (
          <>
            <button type="button" className="btn btn--primary btn--lg" onClick={send}>
              📤 傳給朋友
            </button>
            <code className="code-box code-box--wrap">{url}</code>
            <p className="muted small center-text">還有 {daysLeft} 天有效 · 帳本有改會在同步時自動更新</p>
          </>
        )}

        <div className="label">貼到 LINE 的預覽</div>
        {preview}
        <label className="row gap-s center small">
          <input type="checkbox" checked={showTitle} onChange={(e) => setShowTitle(e.target.checked)} />
          預覽顯示帳本名稱（這是唯一沒加密的部分，不含金額）
        </label>
        {showTitle && <input className="input" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultOgTitle(p, cat.unnamed)} />}

        {!live ? (
          <>
            <div className="label">連結有效期限</div>
            <div className="chip-row">
              {SHARE_DURATIONS.map((d) => (
                <button key={d.days} type="button" className={`chip ${days === d.days ? 'is-on' : ''}`} onClick={() => setDays(d.days)}>
                  {d.label}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => run(() => createShare(p.id, days, og), '連結產生好了，傳出去吧', '🔗')}>
              {busy ? '產生中…' : '產生連結'}
            </button>
          </>
        ) : (
          <div className="row gap wrap">
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => run(() => createShare(p.id, days, og), '已更新', '✅')}>
              儲存預覽設定・延長 {days} 天
            </button>
            <button type="button" className="btn btn--ghost btn--danger-text" disabled={busy} onClick={() => run(() => revokeShare(p.id), '連結已停用', '🚫')}>
              停用連結
            </button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
