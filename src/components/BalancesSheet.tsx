import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { personBalances, type PersonBalance } from '../lib/balances'
import { fmtMoney } from '../lib/split'
import { fmtDateShort, payLines } from '../lib/reminder'
import { shareUrl } from '../lib/share'
import { navigate } from '../router'
import { Avatar, Sheet } from './ui'

/** 誰欠我多少：跨帳本加總、抵銷、一次催款。 */
export default function BalancesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projects = useStore((s) => s.data.projects)
  const me = useStore((s) => s.data.me)
  const base = useStore((s) => s.data.baseCurrency)
  const payInfo = useStore((s) => s.data.payInfo)
  const showToast = useStore((s) => s.showToast)
  const [openId, setOpenId] = useState<string | null>(null)
  const balances = useMemo(() => personBalances(projects, me.id, base), [projects, me.id, base])
  const total = balances.reduce((a, b) => a + Math.max(0, b.net), 0)

  const remind = async (b: PersonBalance) => {
    const owed = b.lines.filter((l) => l.signed > 0)
    const lines = [`${b.person.name}～ 幫你整理了一下，總共還有 ${fmtMoney(b.net, base)}：`]
    for (const l of owed) lines.push(`・${fmtDateShort(l.project.date)} ${l.project.emoji}${l.project.name || '未命名'} ${fmtMoney(l.signed, base)}`)
    if (b.iOwe > 0) lines.push(`（已扣掉我欠你的 ${fmtMoney(b.iOwe, base)}）`)
    const pay = payLines(payInfo)
    if (pay.length) lines.push('轉這裡就好：', ...pay)
    const links = owed.map((l) => l.project.share).filter((s): s is NonNullable<typeof s> => !!s && s.expiresAt > Date.now())
    if (links.length === 1) lines.push(`明細：${shareUrl(links[0].id, links[0].key)}`)
    const text = lines.join('\n')
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        showToast('已複製，貼給對方吧', '📋')
      }
    } catch {
      /* cancelled */
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="👥 誰還欠我" tall>
      <div className="stack">
        <p className="muted small">把每個人在所有帳本裡還沒還的加起來，互相欠的會自動抵銷。外幣沒設匯率的另外列，不算進總數。</p>
        {balances.length === 0 ? (
          <p className="center-text">目前沒有人欠你 🎉</p>
        ) : (
          <div className="stack-s">
            {balances.map((b) => {
              const expanded = openId === b.person.id
              return (
                <div key={b.person.id} className={`card stack-s balance c-border-${b.person.color}`}>
                  <button type="button" className="row gap center list-row" onClick={() => setOpenId(expanded ? null : b.person.id)}>
                    <Avatar person={b.person} size={40} />
                    <div className="grow left">
                      <div className="strong">{b.person.name}</div>
                      <div className="muted small">
                        {b.lines.length} 筆{b.foreign.length ? ` + ${b.foreign.length} 筆外幣` : ''}
                        {b.iOwe > 0 && b.owesMe > 0 && ` · 欠我 ${fmtMoney(b.owesMe, base)} − 我欠 ${fmtMoney(b.iOwe, base)}`}
                      </div>
                    </div>
                    <div className={`balance__net ${b.net >= 0 ? 'is-pos' : 'is-neg'}`}>{b.net >= 0 ? `+${fmtMoney(b.net, base)}` : `−${fmtMoney(-b.net, base)}`}</div>
                  </button>
                  {expanded && (
                    <>
                      <div className="person-result__lines">
                        {[...b.lines, ...b.foreign].map((l) => (
                          <button key={l.project.id + l.transfer.key} type="button" className="line line--btn" onClick={() => { onClose(); navigate(`/p/${l.project.id}/result`) }}>
                            <span>
                              {fmtDateShort(l.project.date)} {l.project.emoji} {l.project.name || '未命名'}
                              {l.transfer.paid > 0 && <span className="muted"> 已還部分</span>}
                            </span>
                            <span className={l.signed >= 0 ? '' : 'muted'}>{l.signed >= 0 ? '' : '我欠 '}{fmtMoney(Math.abs(l.signed), l.currency)}</span>
                          </button>
                        ))}
                      </div>
                      {b.net > 0 && (
                        <button type="button" className="btn btn--butter btn--sm center-self" onClick={() => remind(b)}>
                          📣 一次催 {fmtMoney(b.net, base)}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div className="row between center">
          <span className="muted">合計該收回</span>
          <span className="strong">{fmtMoney(total, base)}</span>
        </div>
      </div>
    </Sheet>
  )
}
