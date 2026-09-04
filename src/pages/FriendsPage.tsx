import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { navigate } from '../router'
import { personBalances, type PersonBalance } from '../lib/balances'
import { computeSplit, fmtMoney } from '../lib/split'
import { fmtDateShort, payLines } from '../lib/reminder'
import { shareUrl } from '../lib/share'
import { isMobile, lineShareUrl } from '../lib/lineShare'
import { Avatar, Empty, Sheet } from '../components/ui'
import PersonShareSheet from '../components/PersonShareSheet'
import type { Person } from '../lib/types'

/** 以人為單位：每個人跨帳本的淨額、明細、一鍵結清、催款。 */
export default function FriendsPage() {
  const data = useStore((s) => s.data)
  const updateProject = useStore((s) => s.updateProject)
  const showToast = useStore((s) => s.showToast)
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<PersonBalance | null>(null)
  const [linkFor, setLinkFor] = useState<Person | null>(null)
  const personShares = useStore((s) => s.data.personShares)
  const base = data.baseCurrency
  const balances = useMemo(() => personBalances(data.projects, data.me.id, base, data.trips ?? []), [data.projects, data.me.id, base, data.trips])
  // 沒有未結清的人也列出來（完全結清）
  const settledFriends = data.friends.filter((f) => !balances.some((b) => b.person.id === f.id))
  const totalOwed = balances.reduce((a, b) => a + Math.max(0, b.net), 0)
  const totalIOwe = balances.reduce((a, b) => a + Math.max(0, -b.net), 0)

  const buildText = (b: PersonBalance) => {
    const owed = b.lines.filter((l) => l.signed > 0)
    const lines = [`${b.person.name}～ 幫你整理了一下，總共還有 ${fmtMoney(b.net, base)}：`]
    for (const l of owed) lines.push(`・${fmtDateShort(l.project.date)} ${l.project.emoji}${l.project.name || '未命名'} ${fmtMoney(l.signed, base)}`)
    if (b.iOwe > 0) lines.push(`（已扣掉我欠你的 ${fmtMoney(b.iOwe, base)}）`)
    const pay = payLines(data.payInfo)
    if (pay.length) lines.push('轉這裡就好：', ...pay)
    const links = owed.map((l) => l.project.share).filter((s): s is NonNullable<typeof s> => !!s && s.expiresAt > Date.now())
    if (links.length === 1) lines.push(`明細：${shareUrl(links[0].id, links[0].key)}`)
    return lines.join('\n')
  }
  const remind = async (b: PersonBalance) => {
    const text = buildText(b)
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        showToast('已複製', '📋')
      }
    } catch {
      /* cancelled */
    }
  }
  /** 把這個人所有欠我的轉帳都標已還（互相欠的也一起清，因為淨額已抵銷） */
  const settleAll = (b: PersonBalance) => {
    let n = 0
    for (const l of [...b.lines, ...b.foreign]) {
      updateProject(l.project.id, (pp) => {
        pp.settled[l.transfer.key] = true
        if (l.transfer.to === pp.payerId) delete pp.settled[l.transfer.from]
      })
      n++
    }
    setConfirm(null)
    showToast(`${b.person.name} 的 ${n} 筆全部標為已還`, '✅')
  }

  return (
    <div className="page">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label="返回">
          ←
        </button>
        <h1 className="topbar__title">👥 朋友</h1>
        <span style={{ width: 40 }} />
      </header>

      <div className="row gap">
        <div className="card card--pink hero-stat grow">
          <div>
            <div className="hero-stat__label">該收回</div>
            <div className="hero-stat__value">{fmtMoney(totalOwed, base)}</div>
          </div>
        </div>
        <div className="card card--mint hero-stat grow">
          <div>
            <div className="hero-stat__label">我該付</div>
            <div className="hero-stat__value">{fmtMoney(totalIOwe, base)}</div>
          </div>
        </div>
      </div>

      <main className="stack">
        <p className="muted small">每個人在<b>所有帳本</b>的未結清金額加總，互相欠的自動抵銷；外幣沒設匯率的另外列、不算進淨額。</p>
        {balances.length === 0 && settledFriends.length === 0 && <Empty title="還沒有人跟你有帳" hint="開帳本加朋友之後，這裡會列出每個人的往來。" />}
        <div className="stack-s">
          {balances.map((b) => {
            const expanded = openId === b.person.id
            const settledCount = data.projects.reduce((a, p) => a + computeSplit(p, base).transfers.filter((t) => t.settled && (t.from === b.person.id || t.to === b.person.id)).length, 0)
            return (
              <div key={b.person.id} className={`card stack-s balance c-border-${b.person.color}`}>
                <button type="button" className="row gap center list-row" onClick={() => setOpenId(expanded ? null : b.person.id)}>
                  <Avatar person={b.person} size={44} />
                  <div className="grow left">
                    <div className="strong">{b.person.name}</div>
                    <div className="muted small">
                      {b.lines.length + b.foreign.length} 筆未結{settledCount ? ` · ${settledCount} 筆已還` : ''}
                      {b.iOwe > 0 && b.owesMe > 0 && ` · 欠我 ${fmtMoney(b.owesMe, base)} − 我欠 ${fmtMoney(b.iOwe, base)}`}
                    </div>
                  </div>
                  <div className={`balance__net ${b.net >= 0 ? 'is-pos' : 'is-neg'}`}>{b.net >= 0 ? `+${fmtMoney(b.net, base)}` : `−${fmtMoney(-b.net, base)}`}</div>
                </button>
                {expanded && (
                  <>
                    <div className="person-result__lines">
                      {[...b.lines, ...b.foreign].map((l) => (
                        <button key={l.project.id + l.transfer.key} type="button" className="line line--btn" onClick={() => navigate(`/p/${l.project.id}/result`)}>
                          <span>
                            {fmtDateShort(l.project.date)} {l.project.emoji} {l.project.name || '未命名'}
                            {l.transfer.paid > 0 && <span className="muted"> 已還部分</span>}
                          </span>
                          <span className={l.signed >= 0 ? '' : 'muted'}>
                            {l.signed >= 0 ? '' : '我欠 '}
                            {fmtMoney(Math.abs(l.signed), l.currency)}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="row gap-s wrap">
                      {b.net > 0 && isMobile() && (
                        <a className="btn btn--mint btn--sm" href={lineShareUrl(buildText(b))} target="_blank" rel="noreferrer">
                          💚 LINE 催 {fmtMoney(b.net, base)}
                        </a>
                      )}
                      {b.net > 0 && (
                        <button type="button" className="btn btn--butter btn--sm" onClick={() => remind(b)}>
                          📣 其他方式
                        </button>
                      )}
                      <button type="button" className={`btn btn--sm ${personShares?.[b.person.id] && personShares[b.person.id].expiresAt > Date.now() ? 'btn--mint' : 'btn--ghost'}`} onClick={() => setLinkFor(b.person)}>
                        🔗 給{b.person.name}的連結
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirm(b)}>
                        ✅ 全部結清
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
          {settledFriends.map((f) => (
            <div key={f.id} className="card row gap center" style={{ opacity: 0.7 }}>
              <Avatar person={f} size={36} />
              <div className="grow strong">{f.name}</div>
              <span className="pill pill--mint">✓ 兩不相欠</span>
            </div>
          ))}
        </div>
      </main>

      <PersonShareSheet person={linkFor} open={!!linkFor} onClose={() => setLinkFor(null)} />
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title="全部結清">
        {confirm && (
          <div className="stack">
            <p className="small">
              把 {confirm.person.name} 在 {confirm.lines.length + confirm.foreign.length} 本帳的往來全部標為已還（含互相欠的那幾筆，因為已經抵銷）。這只是標記，不會動金額。
            </p>
            <div className="row gap">
              <button type="button" className="btn btn--ghost grow" onClick={() => setConfirm(null)}>
                取消
              </button>
              <button type="button" className="btn btn--primary grow" onClick={() => settleAll(confirm)}>
                確定，都清了
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}
