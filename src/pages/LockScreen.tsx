import { useCallback, useState } from 'react'
import { useStore } from '../store'
import { Mascot } from '../components/ui'
import PinPad from '../components/PinPad'

export default function LockScreen() {
  const unlock = useStore((s) => s.unlock)
  const wipe = useStore((s) => s.wipe)
  const [shake, setShake] = useState(0)
  const [busy, setBusy] = useState(false)
  const [fails, setFails] = useState(0)
  const [confirmWipe, setConfirmWipe] = useState(false)

  const onComplete = useCallback(
    async (pin: string) => {
      setBusy(true)
      const ok = await unlock(pin)
      setBusy(false)
      if (!ok) {
        setShake((s) => s + 1)
        setFails((f) => f + 1)
        if (navigator.vibrate) navigator.vibrate([60, 40, 60])
      }
    },
    [unlock],
  )

  return (
    <div className="lock">
      <div className="lock__hero">
        <Mascot size={120} mood={fails ? 'sad' : 'sleepy'} className="mascot--float" />
        <h1 className="lock__title">반반 BanBan</h1>
        <p className="lock__sub">{busy ? '解鎖中…' : fails ? `PIN 不對喔（${fails}）` : '輸入 PIN 打開你的帳本'}</p>
      </div>
      <PinPad onComplete={onComplete} shake={shake} disabled={busy} />
      <div className="lock__foot">
        {!confirmWipe ? (
          <button type="button" className="link" onClick={() => setConfirmWipe(true)}>
            忘記 PIN？
          </button>
        ) : (
          <div className="lock__wipe">
            <p>PIN 沒有存在任何地方，忘了就無法解密。你可以清除所有資料重新開始。</p>
            <div className="row gap">
              <button type="button" className="btn btn--ghost" onClick={() => setConfirmWipe(false)}>
                再想想
              </button>
              <button type="button" className="btn btn--danger" onClick={() => wipe()}>
                清除全部資料
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
