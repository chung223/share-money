import { useState } from 'react'
import { useStore } from '../store'
import { parseSecret } from '../lib/sync'
import { Sheet } from './ui'
import QrCode from './QrCode'
import QrCamera from './QrCamera'

function fmtTime(t: number | null) {
  if (!t) return '還沒同步過'
  const d = new Date(t)
  const diff = Date.now() - t
  if (diff < 60_000) return '剛剛'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`
  return d.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function SyncSection() {
  const cfg = useStore((s) => s.data.sync)
  const sync = useStore((s) => s.sync)
  const enableSync = useStore((s) => s.enableSync)
  const disableSync = useStore((s) => s.disableSync)
  const syncNow = useStore((s) => s.syncNow)
  const showToast = useStore((s) => s.showToast)
  const [busy, setBusy] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [join, setJoin] = useState<null | 'paste' | 'scan'>(null)
  const [pasted, setPasted] = useState('')
  const [confirmOff, setConfirmOff] = useState(false)

  const run = async (fn: () => Promise<void>, okMsg?: string, emoji?: string) => {
    setBusy(true)
    try {
      await fn()
      if (okMsg) showToast(okMsg, emoji)
    } catch (e) {
      showToast(e instanceof Error ? e.message : '失敗了', '😵')
    } finally {
      setBusy(false)
    }
  }

  const joinWith = (text: string) => {
    const secret = parseSecret(text)
    if (!secret) return false
    setJoin(null)
    run(() => enableSync(secret), '已連上，資料合併好了', '☁️')
    return true
  }

  const statusText =
    sync.status === 'syncing' ? '同步中…' : sync.status === 'offline' ? '離線，之後會自動補同步' : sync.status === 'error' ? sync.error : sync.dirty ? '有變更還沒上傳' : '已同步'
  const statusEmoji = sync.status === 'syncing' ? '🔄' : sync.status === 'offline' ? '📴' : sync.status === 'error' ? '⚠️' : sync.dirty ? '⏳' : '✅'

  return (
    <section className="card stack">
      <div className="section-title">☁️ 多裝置同步</div>
      {!cfg ? (
        <>
          <p className="muted small">手機記、電腦看。資料先用你這台的金鑰加密才上傳，伺服器只看得到亂碼。分享連結給朋友也需要開這個。金鑰就是你的身分：沒有帳號密碼、也沒有「忘記密碼」，請把 QR 或那串文字存好。180 天沒同步的雲端資料會被清掉。</p>
          <div className="row gap wrap">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => enableSync(), '同步開好了，去另一台裝置掃 QR 就能連', '☁️')}>
              建立同步金鑰
            </button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setJoin('scan')}>
              我有另一台的金鑰
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="sync-status">
            <span className="sync-status__emoji">{statusEmoji}</span>
            <div className="grow">
              <div className="strong">{statusText}</div>
              <div className="muted small">上次同步：{fmtTime(sync.lastSyncAt)}</div>
            </div>
          </div>
          <div className="row gap wrap">
            <button type="button" className="btn btn--primary" disabled={busy || sync.status === 'syncing'} onClick={() => syncNow()}>
              立即同步
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setShowKey(true)}>
              顯示金鑰 QR
            </button>
            <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => setConfirmOff(true)}>
              停用
            </button>
          </div>
        </>
      )}

      <Sheet open={showKey} onClose={() => setShowKey(false)} title="同步金鑰">
        {cfg && (
          <div className="stack center-items">
            <p className="muted small center-text">在另一台裝置打開 반반 → 設定 → 多裝置同步 → 「我有另一台的金鑰」掃這個。</p>
            <QrCode text={cfg.secret} />
            <code className="code-box">{cfg.secret}</code>
            <p className="small danger-text center-text">拿到這串的人就能解開你的所有帳本，別貼到群組裡。反過來說，所有裝置都不見又沒存這串，雲端的資料就拿不回來了。</p>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() =>
                navigator.clipboard
                  .writeText(cfg.secret)
                  .then(() => showToast('已複製金鑰', '📋'))
                  .catch(() => showToast('複製失敗，請長按選取', '🙈'))
              }
            >
              📋 複製文字
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={join !== null} onClose={() => setJoin(null)} title="連到另一台裝置" tall={join === 'scan'}>
        <div className="stack">
          {join === 'scan' ? (
            <QrCamera onText={joinWith} hint="對準另一台裝置上「顯示金鑰 QR」的畫面" />
          ) : (
            <>
              <input className="input" placeholder="bb1.…" value={pasted} onChange={(e) => setPasted(e.target.value)} autoFocus />
              <button type="button" className="btn btn--primary" disabled={!parseSecret(pasted) || busy} onClick={() => joinWith(pasted)}>
                連線並合併資料
              </button>
            </>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => setJoin(join === 'scan' ? 'paste' : 'scan')}>
            {join === 'scan' ? '⌨️ 改用貼上文字' : '📷 改用掃描'}
          </button>
        </div>
      </Sheet>

      <Sheet open={confirmOff} onClose={() => setConfirmOff(false)} title="停用同步">
        <div className="stack">
          <p className="small">這台的資料會留著。要不要順便把雲端那份也刪掉？刪了之後其他裝置和分享連結都會失效。</p>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => run(() => disableSync(false), '已停用，雲端資料保留', '☁️').then(() => setConfirmOff(false))}>
            只在這台停用
          </button>
          <button type="button" className="btn btn--danger" disabled={busy} onClick={() => run(() => disableSync(true), '已停用並刪除雲端資料', '🧹').then(() => setConfirmOff(false))}>
            停用並刪除雲端資料
          </button>
        </div>
      </Sheet>
    </section>
  )
}
