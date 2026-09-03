import { useState } from 'react'
import { useStore } from '../store'
import type { Trip } from '../lib/types'
import { tripJoinUrl } from '../lib/tripSync'
import { Sheet } from './ui'
import QrCode from './QrCode'
import { isMobile, lineShareUrl } from '../lib/lineShare'

/** 共編：產生「連結＋金鑰」給同行的人；拿到的人可以一起記、一起看結算。 */
export default function TripShareSheet({ trip, open, onClose }: { trip: Trip; open: boolean; onClose: () => void }) {
  const shareTrip = useStore((s) => s.shareTrip)
  const stopSharingTrip = useStore((s) => s.stopSharingTrip)
  const syncTrip = useStore((s) => s.syncTrip)
  const showToast = useStore((s) => s.showToast)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const url = trip.share ? tripJoinUrl(trip.share.id, trip.share.secret) : null
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      showToast(ok, '👥')
    } catch (e) {
      showToast(e instanceof Error ? e.message : '失敗了', '😵')
    } finally {
      setBusy(false)
    }
  }
  const send = async () => {
    if (!url) return
    const text = `${trip.emoji} ${trip.name}｜一起記帳：${url}\n點開選自己是誰，就能看到結算、也能一起加帳本。`
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        showToast('已複製連結', '📋')
      }
    } catch {
      /* cancelled */
    }
  }
  return (
    <Sheet open={open} onClose={() => { onClose(); setConfirm(false) }} title="👥 共編這趟旅程" tall={!!trip.share}>
      <div className="stack">
        {!trip.share ? (
          <>
            <p className="muted small">產生一個連結給同行的人，大家都能加帳本、改明細、看整趟結算。內容用連結裡的金鑰加密，伺服器只存亂碼；拿到連結的人都能改，所以只給同行的人。</p>
            <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => run(() => shareTrip(trip.id), '共編開好了，把連結傳出去吧')}>
              {busy ? '建立中…' : '產生共編連結'}
            </button>
          </>
        ) : (
          <>
            <div className="center-items stack-s">
              <QrCode text={url!} size={200} />
              <code className="code-box code-box--wrap">{url}</code>
            </div>
            <div className="row gap">
              {isMobile() && (
                <a className="btn btn--mint btn--lg grow" href={lineShareUrl(`${trip.emoji} ${trip.name}｜一起記帳：${url}\n點開選自己是誰，就能看到結算、也能一起加帳本。`)} target="_blank" rel="noreferrer">
                  💚 傳到 LINE
                </a>
              )}
              <button type="button" className="btn btn--primary btn--lg grow" onClick={send}>
                📤 其他方式
              </button>
            </div>
            <p className="muted small center-text">
              你是{trip.share.role === 'owner' ? '發起人' : '成員'} · 伺服器版本 {trip.share.version} · 改動會在幾秒內自動同步
            </p>
            <div className="row gap wrap">
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => run(() => syncTrip(trip.id, { quiet: false }), '已同步')}>
                🔄 立即同步
              </button>
              {!confirm ? (
                <button type="button" className="btn btn--ghost btn--sm btn--danger-text" onClick={() => setConfirm(true)}>
                  {trip.share.role === 'owner' ? '停止共編' : '退出共編'}
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => run(() => stopSharingTrip(trip.id, false), '已改為只在本機')}>
                    只在這台停止（資料留著）
                  </button>
                  {trip.share.role === 'owner' && (
                    <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => run(() => stopSharingTrip(trip.id, true), '已刪除雲端副本，其他人下次同步會變成本機版')}>
                      停止並刪除雲端副本
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
