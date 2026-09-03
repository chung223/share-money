import { useEffect, useMemo, useState } from 'react'
import { computeSplit, fmtMoney } from '../lib/split'
import { decryptSnapshot, encryptNote, parseShareLocation, type ShareSnapshot } from '../lib/share'
import type { Project } from '../lib/types'
import { Avatar, Confetti, Mascot } from '../components/ui'
import { categoryOf } from '../lib/category'

type Status = { kind: 'loading' } | { kind: 'error'; title: string; hint: string; mood: 'sad' | 'sleepy' } | { kind: 'ok'; snap: ShareSnapshot; paid: string[] }

const loc = parseShareLocation(location)
const WHO_KEY = loc ? `banban:share:${loc.id}:who` : ''

export default function SharePage() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [who, setWho] = useState<string | null>(() => (WHO_KEY ? localStorage.getItem(WHO_KEY) : null))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [myNotes, setMyNotes] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(WHO_KEY + ':notes') || '{}')
    } catch {
      return {}
    }
  })
  const [toast, setToast] = useState<string | null>(null)
  const [confetti, setConfetti] = useState(false)

  useEffect(() => {
    if (!loc) {
      setStatus({ kind: 'error', title: '這個連結不完整', hint: '請對方重新分享一次（連結 # 後面的那串不能少）。', mood: 'sad' })
      return
    }
    ;(async () => {
      try {
        const r = await fetch(`/api/share/${loc.id}`, { cache: 'no-store' })
        if (r.status === 404) return setStatus({ kind: 'error', title: '找不到這個帳本', hint: '連結可能已經被停用了。', mood: 'sad' })
        if (r.status === 410) return setStatus({ kind: 'error', title: '連結過期了', hint: '請對方再產生一次新的連結。', mood: 'sleepy' })
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const j = (await r.json()) as { cipher: string; paid: string[] }
        const snap = await decryptSnapshot(loc.key, j.cipher)
        setStatus({ kind: 'ok', snap, paid: j.paid })
      } catch (e) {
        setStatus({ kind: 'error', title: '打不開', hint: e instanceof DOMException || (e instanceof Error && /decrypt|JSON/i.test(e.message)) ? '金鑰對不上，請確認連結有完整複製。' : '網路怪怪的，等一下再試。', mood: 'sad' })
      }
    })()
  }, [])

  const flash = (t: string) => {
    setToast(t)
    setTimeout(() => setToast(null), 2200)
  }

  const project: Project | null = status.kind === 'ok' ? { ...status.snap.project, share: undefined } : null
  const result = useMemo(() => (project && status.kind === 'ok' ? computeSplit(project, status.snap.baseCurrency) : null), [project, status])

  if (status.kind === 'loading') {
    return (
      <div className="splash">
        <Mascot size={96} className="mascot--float" />
        <div className="splash__name">반반</div>
      </div>
    )
  }
  if (status.kind === 'error') {
    return (
      <div className="page share-page">
        <div className="empty">
          <Mascot size={110} mood={status.mood} className="mascot--float" />
          <div className="empty__title">{status.title}</div>
          <div className="empty__hint">{status.hint}</div>
        </div>
        <Footer />
      </div>
    )
  }

  const { snap, paid } = status
  const p = project!
  const r = result!
  const base = snap.baseCurrency
  const foreign = p.currency !== base
  const payer = p.people.find((x) => x.id === p.payerId)
  const me = who ? r.people.find((x) => x.person.id === who) : null
  const myTransfers = who ? r.transfers.filter((t) => t.from === who) : []
  const meIsPayer = me ? (r.multiPayer ? myTransfers.length === 0 : me.isPayer) : false
  const pay = snap.payInfo
  const ownerId = snap.ownerId ?? p.payerId
  const nameOf = (id: string) => p.people.find((x) => x.id === id)
  // legacy links report by personId; new ones by transfer key
  const isReported = (t: { key: string; from: string; to: string }) => paid.includes(t.key) || (t.to === p.payerId && paid.includes(t.from))

  const choose = (id: string) => {
    setWho(id)
    if (WHO_KEY) localStorage.setItem(WHO_KEY, id)
  }
  const report = async (key: string, kind: 'paid' | 'unpaid') => {
    if (!who || !loc) return
    setBusy(true)
    try {
      const label = nameOf(who)?.name
      const text = note.trim().slice(0, 200)
      const enc = kind === 'paid' && text ? await encryptNote(loc.key, text) : undefined
      const res = await fetch(`/api/share/${loc.id}/paid`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personId: key, kind, note: enc, label }) })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const nextNotes = { ...myNotes }
      if (kind === 'paid' && text) nextNotes[key] = text
      else delete nextNotes[key]
      setMyNotes(nextNotes)
      try {
        localStorage.setItem(WHO_KEY + ':notes', JSON.stringify(nextNotes))
      } catch {
        /* ignore */
      }
      setNote('')
      const rest = paid.filter((x) => x !== key && x !== who)
      setStatus({ kind: 'ok', snap, paid: kind === 'paid' ? [...rest, key] : rest })
      if (kind === 'paid') {
        setConfetti(true)
        setTimeout(() => setConfetti(false), 2600)
        flash(`已通知 ${snap.ownerName}，謝謝你 💖`)
      } else flash('已取消')
    } catch {
      flash('送不出去，等一下再試')
    } finally {
      setBusy(false)
    }
  }
  const copy = (text: string, what: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => flash(`已複製${what}`))
      .catch(() => flash('複製失敗，請長按選取'))

  return (
    <div className="page share-page">
      <Confetti on={confetti} />
      <header className="topbar">
        <div className="brand">
          <Mascot size={40} />
          <div>
            <div className="brand__name">반반 BanBan</div>
            <div className="brand__sub">{snap.ownerName} 幫大家先付了</div>
          </div>
        </div>
      </header>

      <main className="stack">
        <div className="card card--pink total-card">
          <div>
            <div className="total-card__label">
              {p.emoji} {p.name || categoryOf(p).unnamed} · {p.date}
            </div>
            <div className="total-card__value">{fmtMoney(r.grandTotalRounded, p.currency)}</div>
            {foreign && r.baseGrandTotal != null && <div className="total-card__base">≈ {fmtMoney(r.baseGrandTotal, base)}</div>}
            {r.multiPayer ? (
              <div className="total-card__payer">先付：{r.people.filter((x) => x.paid > 0).map((x) => `${x.person.emoji}${x.person.name} ${fmtMoney(x.paid, p.currency)}`).join('、')}</div>
            ) : (
              payer && <div className="total-card__payer">由 {payer.emoji} {payer.name} 代墊 · {p.people.length} 人</div>
            )}
          </div>
          <div className="total-card__emoji">🧾</div>
        </div>

        <section className="card stack">
          <div className="section-title">{me ? '你是' : '你是哪一位？'}</div>
          <div className="chip-row">
            {p.people.map((x) => (
              <button key={x.id} type="button" className={`chip chip--person ${who === x.id ? 'is-on' : ''}`} onClick={() => choose(x.id)}>
                <span className={`mini-avatar c-${x.color}`}>{x.emoji}</span> {x.name}
              </button>
            ))}
          </div>
        </section>

        {me && (
          <section className={`card stack person-result c-border-${me.person.color}`}>
            <div className="row gap center">
              <Avatar person={me.person} size={48} />
              <div className="grow">
                <div className="muted small">{meIsPayer ? '你是代墊的人' : '你的份'}</div>
                <div className="share-amount">{fmtMoney(me.totalRounded, p.currency)}</div>
                {foreign && me.baseTotal != null && <div className="muted small">≈ {fmtMoney(me.baseTotal, base)}</div>}
                {me.exactBeforeRounding != null && <div className="muted small">（{fmtMoney(me.exactBeforeRounding, r.overchargeCurrency)} 進位到 {p.rounding}）</div>}
              </div>
            </div>
            {me.lines.length > 0 && (
              <div className="person-result__lines">
                {me.lines.map((l, i) => (
                  <div key={i} className="line">
                    <span>
                      {l.name || '（未命名）'}
                      {l.sharers > 1 && <span className="muted"> ÷{l.sharers}</span>}
                    </span>
                    <span>{fmtMoney(l.amount, p.currency, { compact: true })}</span>
                  </div>
                ))}
                {me.extras.map((e, i) => (
                  <div key={'e' + i} className="line line--extra">
                    <span>
                      {e.emoji} {e.name}
                    </span>
                    <span>{fmtMoney(e.amount, p.currency, { compact: true })}</span>
                  </div>
                ))}
              </div>
            )}

            {!meIsPayer &&
              myTransfers.map((t) => {
                const to = nameOf(t.to)
                const toOwner = t.to === ownerId
                const reported = isReported(t)
                return (
                  <div key={t.key} className="pay-box stack-s">
                    <div className="label">
                      轉給 {to?.emoji} {to?.name}
                      {r.multiPayer && <span className="strong"> {fmtMoney(t.amount, p.currency)}</span>}
                      {r.multiPayer && foreign && t.baseAmount != null && <span className="muted"> ≈ {fmtMoney(t.baseAmount, base)}</span>}
                    </div>
                    {t.paid > 0 && !t.settled && (
                      <div className="small">
                        已還 {fmtMoney(t.paid, t.dueCurrency)}，還差 <span className="strong">{fmtMoney(t.remaining, t.dueCurrency)}</span>
                      </div>
                    )}
                    {toOwner && pay && (pay.account || pay.linePay) ? (
                      <>
                        {pay.account && (
                          <button type="button" className="pay-box__row" onClick={() => copy(`${pay.bankCode ? pay.bankCode + ' ' : ''}${pay.account}`, '帳號')}>
                            <span>
                              🏦 {pay.bankCode}
                              {pay.bankName ? ` ${pay.bankName}` : ''}
                            </span>
                            <span className="strong">{pay.account}</span>
                            <span className="muted small">複製</span>
                          </button>
                        )}
                        {pay.linePay && (
                          <a className="btn btn--mint" href={pay.linePay} target="_blank" rel="noreferrer">
                            💚 用 LINE Pay / 街口 轉帳
                          </a>
                        )}
                        {pay.note && <div className="muted small">{pay.note}</div>}
                      </>
                    ) : (
                      <p className="muted small">{toOwner ? `${snap.ownerName} 還沒留轉帳資訊，直接問本人吧。` : `帳號直接問 ${to?.name} 吧。`}</p>
                    )}
                    {t.settled ? (
                      <div className="pill pill--mint center-self">✓ {to?.name} 已確認收到</div>
                    ) : reported ? (
                      <div className="stack-s">
                        <div className="pill pill--mint center-self">✅ 已回報「我轉了」{myNotes[t.key] ? `：${myNotes[t.key]}` : ''}</div>
                        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => report(t.key, 'unpaid')}>
                          按錯了，取消
                        </button>
                      </div>
                    ) : (
                      <div className="stack-s">
                        <input className="input" placeholder="備註（選填）：LINE Pay、末五碼 12345…" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
                        <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => report(t.key, 'paid')}>
                          💸 我轉了
                        </button>
                        <p className="muted small center-text">備註只有 {snap.ownerName} 看得到（用連結裡的金鑰加密）。</p>
                      </div>
                    )}
                  </div>
                )
              })}
            {me && !meIsPayer && myTransfers.length === 0 && <p className="muted small">你不用轉錢 🎉</p>}
          </section>
        )}

        <section className="card stack">
          <div className="section-title">大家的份</div>
          <div className="stack-xs">
            {r.people.map((x) => {
              const done = (r.multiPayer ? x.paid > 0 && r.transfers.every((t) => t.from !== x.person.id) : x.isPayer) || x.settled
              const reported = !done && r.transfers.some((t) => t.from === x.person.id && !t.settled && isReported(t))
              return (
                <div key={x.person.id} className="line line--person">
                  <span className="row gap-s center">
                    <span className={`mini-avatar c-${x.person.color}`}>{x.person.emoji}</span>
                    {x.person.name}
                    {(r.multiPayer ? x.paid > 0 : x.isPayer) && <span className="pill pill--butter">⭐ {r.multiPayer ? `先付 ${fmtMoney(x.paid, p.currency)}` : '代墊'}</span>}
                  </span>
                  <span className="row gap-s center">
                    <span className={done ? 'muted' : 'strong'}>{fmtMoney(x.totalRounded, p.currency)}</span>
                    {x.settled && <span title="已還">✓</span>}
                    {reported && <span title="已回報轉帳">💸</span>}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      </main>
      <Footer />
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function Footer() {
  return (
    <p className="muted small center-text share-footer">
      這頁的內容只有拿到連結的人解得開 ·{' '}
      <a href="/" className="link">
        我也想用 반반 分帳
      </a>
    </p>
  )
}
