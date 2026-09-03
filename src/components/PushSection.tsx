import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { disablePush, enablePush, isIOS, isStandalone, pushStatus, testPush } from '../lib/push'

export default function PushSection() {
  const cfg = useStore((s) => s.data.sync)
  const showToast = useStore((s) => s.showToast)
  const [status, setStatus] = useState<'unsupported' | 'denied' | 'on' | 'off' | 'loading'>('loading')
  const [busy, setBusy] = useState(false)
  const refresh = () => pushStatus().then(setStatus)
  useEffect(() => {
    refresh()
  }, [])
  const run = async (fn: () => Promise<void>, ok: string, emoji: string) => {
    setBusy(true)
    try {
      await fn()
      showToast(ok, emoji)
    } catch (e) {
      showToast(e instanceof Error ? e.message : '失敗了', '😵')
    } finally {
      setBusy(false)
      refresh()
    }
  }
  const iosNotInstalled = isIOS() && !isStandalone()
  return (
    <section className="card stack">
      <div className="section-title">🔔 推播通知</div>
      <p className="muted small">朋友在分享頁按「我轉了」時通知你。伺服器只知道對方留的名字，不知道金額。</p>
      {!cfg ? (
        <p className="small">要先開啟上面的多裝置同步，通知才有地方送。</p>
      ) : status === 'unsupported' ? (
        <p className="small">{iosNotInstalled ? 'iPhone 要先用 Safari「加入主畫面」，從主畫面打開才有推播（iOS 16.4 以上）。' : '這個瀏覽器不支援推播。'}</p>
      ) : status === 'denied' ? (
        <p className="small">通知被封鎖了，要到瀏覽器／系統設定裡重新允許。</p>
      ) : (
        <div className="row gap wrap">
          {status === 'on' ? (
            <>
              <span className="pill pill--mint">✅ 這台裝置已開啟</span>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => run(() => testPush(cfg), '已送出測試通知', '🔔')}>
                測試
              </button>
              <button type="button" className="btn btn--ghost btn--sm btn--danger-text" disabled={busy} onClick={() => run(() => disablePush(cfg), '已關閉推播', '🔕')}>
                關閉
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--primary" disabled={busy || status === 'loading'} onClick={() => run(() => enablePush(cfg), '推播開好了', '🔔')}>
              開啟推播
            </button>
          )}
        </div>
      )}
    </section>
  )
}
