import { useState } from 'react'
import { useStore } from '../store'
import { APP_VERSION, checkForUpdate, hardReload, useUpdate } from '../lib/update'

export default function UpdateSection() {
  const showToast = useStore((s) => s.showToast)
  const checking = useUpdate((s) => s.checking)
  const need = useUpdate((s) => s.needRefresh)
  const [stuck, setStuck] = useState(false)
  const check = async () => {
    setStuck(false)
    const r = await checkForUpdate()
    if (r === 'latest') showToast('已經是最新版', '✨')
    else if (r === 'offline') showToast('連不上伺服器，等一下再試', '📴')
    else {
      showToast('更新中，馬上回來', '🔄')
      setTimeout(() => setStuck(true), 9000)
    }
  }
  return (
    <section className="card stack">
      <div className="section-title">🔄 版本與更新</div>
      <p className="muted small">目前版本 {APP_VERSION}。加到主畫面的 App 有時不會自己換新版，怪怪的先按這裡。</p>
      <div className="row gap wrap">
        <button type="button" className="btn btn--primary" disabled={checking} onClick={check}>
          {checking ? '檢查中…' : need ? '🆕 套用新版本' : '檢查更新'}
        </button>
        {stuck && (
          <button type="button" className="btn btn--ghost" onClick={hardReload}>
            卡住了？強制重載
          </button>
        )}
      </div>
    </section>
  )
}
