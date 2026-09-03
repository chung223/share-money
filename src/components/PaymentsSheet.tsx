import { fmtMoney, type SplitResult } from '../lib/split'
import type { Project } from '../lib/types'
import { Avatar, MoneyInput, Sheet } from './ui'

/** 多人代墊：每個人實際付了多少。加總要等於總計。 */
export default function PaymentsSheet({ open, onClose, p, result, set }: { open: boolean; onClose: () => void; p: Project; result: SplitResult; set: (fn: (p: Project) => void) => void }) {
  const amounts = new Map((p.payments ?? []).map((x) => [x.personId, x.amount]))
  const sum = [...amounts.values()].reduce((a, b) => a + b, 0)
  const diff = Math.round((sum - result.grandTotalRounded) * 100) / 100
  const setAmount = (personId: string, amount: number) =>
    set((pp) => {
      const list = (pp.payments ?? []).filter((x) => x.personId !== personId)
      if (amount > 0) list.push({ personId, amount })
      pp.payments = list
    })
  const fillRest = (personId: string) => setAmount(personId, Math.max(0, Math.round((result.grandTotalRounded - (sum - (amounts.get(personId) ?? 0))) * 100) / 100))

  return (
    <Sheet open={open} onClose={onClose} title="💸 誰付了錢">
      <div className="stack">
        <p className="muted small">例如你付餐、朋友付計程車。填實際付的金額，結果頁會算出最少轉幾次就能結清。</p>
        <div className="stack-s">
          {p.people.map((person) => (
            <div key={person.id} className="row gap center">
              <Avatar person={person} size={36} />
              <span className="grow strong">{person.name}</span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => fillRest(person.id)} title="把剩下的金額填給這個人">
                補齊
              </button>
              <MoneyInput className="input--qty" value={amounts.get(person.id) ?? 0} onChange={(n) => setAmount(person.id, n)} />
            </div>
          ))}
        </div>
        <div className={`pill center-self ${diff === 0 && sum > 0 ? 'pill--mint' : 'pill--pink'}`}>
          已填 {fmtMoney(sum, p.currency)} / 總計 {fmtMoney(result.grandTotalRounded, p.currency)}
          {diff !== 0 && sum > 0 && `（${diff > 0 ? '多' : '少'} ${fmtMoney(Math.abs(diff), p.currency)}）`}
        </div>
        <div className="row gap">
          {(p.payments?.length ?? 0) > 0 && (
            <button type="button" className="btn btn--ghost grow" onClick={() => set((pp) => (pp.payments = []))}>
              改回一人代墊
            </button>
          )}
          <button type="button" className="btn btn--primary grow" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </Sheet>
  )
}
