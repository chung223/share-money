import { useState } from 'react'
import { useStore } from '../store'
import { shareUrl } from '../lib/share'
import { isMobile, lineShareUrl } from '../lib/lineShare'
import type { Person } from '../lib/types'
import { Sheet } from './ui'
import QrCode from './QrCode'

/** 給某個人的跨帳本連結：他點開看到自己在每本帳欠你多少，逐筆按「我轉了」。 */
export default function PersonShareSheet({ person, open, onClose }: { person: Person | null; open: boolean; onClose: () => void }) {
  const share = useStore((s) => (person ? s.data.personShares?.[person.id] : undefined))
  const createPersonShare = useStore((s) => s.createPersonShare)
  const revokePersonShare = useStore((s) => s.revokePersonShare)
  const showToast = useStore((s) => s.showToast)
  const [busy, setBusy] = useState(false)
  const [days, setDays] = useState(30)
  const live = share && share.expiresAt > Date.now() ? share : null
  const url = live ? shareUrl(live.id, live.key) : null
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      showToast(ok, '🔗')
    } catch (e) {
      showToast(e instanceof Error ? e.message : '失敗了', '😵')
    } finally {
      setBusy(false)
    }
  }
  const text = person && url ? `${person.name}～ 這是你的帳單，點開看每筆和總額，轉完按「我轉了」👉 ${url}` : ''
  return (
    <Sheet open={open && !!person} onClose={onClose} title={`🔗 給 ${person?.name ?? ''} 的連結`}>
      {person && (
        <div className="stack">
          <p className="muted small">一條連結列出 {person.name} 在所有帳本跟你的往來，每筆可以各自按「我轉了」，總額一張銀行 QR。帳本有更新會在同步時自動刷新。</p>
          {!live ? (
            <>
              <div className="label">有效期限</div>
              <div className="chip-row">
                {[7, 30, 90].map((d) => (
                  <button key={d} type="button" className={`chip ${days === d ? 'is-on' : ''}`} onClick={() => setDays(d)}>
                    {d} 天
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => run(() => createPersonShare(person.id, days), '連結好了')}>
                {busy ? '產生中…' : '產生連結'}
              </button>
            </>
          ) : (
            <>
              <div className="center-items stack-s">
                <QrCode text={url!} size={160} />
                <code className="code-box code-box--wrap">{url}</code>
              </div>
              <div className="row gap">
                {isMobile() && (
                  <a className="btn btn--mint btn--lg grow" href={lineShareUrl(text)} target="_blank" rel="noreferrer">
                    💚 傳到 LINE
                  </a>
                )}
                <button
                  type="button"
                  className="btn btn--primary btn--lg grow"
                  onClick={async () => {
                    try {
                      if (navigator.share) await navigator.share({ text })
                      else {
                        await navigator.clipboard.writeText(text)
                        showToast('已複製', '📋')
                      }
                    } catch {
                      /* cancelled */
                    }
                  }}
                >
                  📤 其他方式
                </button>
              </div>
              <p className="muted small center-text">到 {new Date(live.expiresAt).toLocaleDateString('zh-TW')} 有效</p>
              <div className="row gap wrap">
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => run(() => createPersonShare(person.id, days), '已延長並更新')}>
                  延長 {days} 天
                </button>
                <button type="button" className="btn btn--ghost btn--sm btn--danger-text" disabled={busy} onClick={() => run(() => revokePersonShare(person.id), '已停用')}>
                  停用
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}
