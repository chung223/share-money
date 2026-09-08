import { useEffect, useState } from 'react'
import { fmtMoney, type Transfer } from '../lib/split'
import type { Project } from '../lib/types'
import { MoneyInput, Sheet } from './ui'

/** 記錄一筆轉帳：全額、部分、或還原。 */
export default function SettleSheet({ p, t, onClose, set }: { p: Project; t: Transfer | null; onClose: () => void; set: (fn: (p: Project) => void) => void }) {
  const [amount, setAmount] = useState(0)
  useEffect(() => {
    if (t) setAmount(t.remaining)
  }, [t])
  if (!t) return null
  const from = p.people.find((x) => x.id === t.from)
  const to = p.people.find((x) => x.id === t.to)
  const cur = t.dueCurrency
  const write = (fn: (pp: Project) => void) => {
    set((pp) => {
      if (t.to === pp.payerId) delete pp.settled[t.from] // migrate legacy key
      fn(pp)
    })
    onClose()
  }
  const full = () => write((pp) => {
    pp.settled[t.key] = true
    if (pp.partial) delete pp.partial[t.key]
  })
  const part = () =>
    write((pp) => {
      const paid = Math.min(t.due, Math.round((t.paid + amount) * 100) / 100)
      pp.partial = { ...(pp.partial ?? {}), [t.key]: paid }
      pp.settled[t.key] = paid >= t.due
    })
  const reset = () =>
    write((pp) => {
      pp.settled[t.key] = false
      if (pp.partial) delete pp.partial[t.key]
    })

  return (
    <Sheet open={!!t} onClose={onClose} title={`${from?.emoji} ${from?.name} → ${to?.emoji} ${to?.name}`}>
      <div className="stack">
        <div className="row between center">
          <span className="muted">應付</span>
          <span className="strong">{fmtMoney(t.due, cur)}</span>
        </div>
        {t.paid > 0 && (
          <div className="row between center">
            <span className="muted">已還</span>
            <span className="strong">{fmtMoney(t.paid, cur)}</span>
          </div>
        )}
        {t.settled ? (
          <>
            <div className="pill pill--mint center-self">✓ 已結清</div>
            <button type="button" className="btn btn--ghost btn--danger-text" onClick={reset}>
              還原成「還沒還」
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn--primary btn--lg" onClick={full}>
              ✓ 全額收到 {fmtMoney(t.remaining, cur)}
            </button>
            <div className="label">或先記一部分</div>
            <div className="row gap center">
              <MoneyInput value={amount} onChange={setAmount} className="grow" />
              <button type="button" className="btn btn--mint" disabled={amount <= 0} onClick={part}>
                記錄
              </button>
            </div>
            {t.paid > 0 && (
              <button type="button" className="btn btn--ghost btn--danger-text btn--sm" onClick={reset}>
                清掉已還紀錄
              </button>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}
