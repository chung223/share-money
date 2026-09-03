import { useEffect, useMemo, useState } from 'react'
import { computeSplit, fmtMoney } from '../lib/split'
import { decryptSnapshot, encryptNote, parseShareLocation, type ShareSnapshot } from '../lib/share'
import { categoryOf } from '../lib/category'
import type { Project } from '../lib/types'
import { Avatar, Confetti, Mascot } from '../components/ui'
import QrCode from '../components/QrCode'
import { QUICK_PAY, twqrTransfer } from '../lib/twqr'

type Status = { kind: 'loading' } | { kind: 'error'; title: string; hint: string; mood: 'sad' | 'sleepy' } | { kind: 'ok'; snap: ShareSnapshot; paid: string[] }

const loc = parseShareLocation(location)
const WHO_KEY = loc ? `banban:share:${loc.id}:who` : ''
const THANKS = ['謝謝你，你最棒了 💖', '收到！已經告訴對方了 🙌', '太快了吧，感謝 🥹', '好人一生平安 ✨']

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
  const [showLines, setShowLines] = useState(false)

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
    setTimeout(() => setToast(null), 2400)
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
  const cat = categoryOf(p)
  const base = snap.baseCurrency
  const foreign = p.currency !== base
  const me = who ? r.people.find((x) => x.person.id === who) : null
  const myTransfers = who ? r.transfers.filter((t) => t.from === who) : []
  const meIsPayer = me ? (r.multiPayer ? myTransfers.length === 0 : me.isPayer) : false
  const pay = snap.payInfo
  const ownerId = snap.ownerId ?? p.payerId
  const nameOf = (id: string) => p.people.find((x) => x.id === id)
  const isReported = (t: { key: string; from: string; to: string }) => paid.includes(t.key) || (t.to === p.payerId && paid.includes(t.from))
  const done = r.transfers.filter((t) => t.settled || isReported(t)).length
  const allDone = r.transfers.length > 0 && done === r.transfers.length
  const myAllDone = me && !meIsPayer && myTransfers.length > 0 && myTransfers.every((t) => t.settled || isReported(t))

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
        flash(THANKS[Math.floor(Math.random() * THANKS.length)])
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
      .then(() => flash(`已複製${what} 📋`))
      .catch(() => flash('複製失敗，請長按選取'))

  return (
    <div className="page share-page">
      <Confetti on={confetti} />

      {/* hero */}
      <div className="share-hero">
        <Mascot size={84} mood={allDone ? 'happy' : 'wow'} className="mascot--float" />
        <div className="share-hero__text">
          <div className="share-hero__owner">{snap.ownerName} 幫大家先付了</div>
          <div className="share-hero__name">
            {p.emoji} {p.name || cat.unnamed}
          </div>
          <div className="muted small">
            {p.date} · {p.people.length} 人 · 總共 {fmtMoney(r.grandTotalRounded, p.currency)}
            {foreign && r.baseGrandTotal != null && ` ≈ ${fmtMoney(r.baseGrandTotal, base)}`}
          </div>
        </div>
      </div>

      <main className="stack">
        {/* who am I */}
        <section className="card stack">
          <div className="section-title">{me ? `你是 ${me.person.emoji} ${me.person.name}` : '👇 點自己的頭像'}</div>
          <div className="friend-grid">
            {p.people.map((x) => {
              const pr = r.people.find((y) => y.person.id === x.id)!
              const on = who === x.id
              return (
                <button key={x.id} type="button" className={`friend ${on ? 'is-on' : ''}`} onClick={() => choose(x.id)}>
                  <Avatar person={x} size={52} active={!who || on} />
                  <span>{x.name}</span>
                  <span className="muted small">{pr.isPayer && !r.multiPayer ? '⭐ 先付' : fmtMoney(pr.totalRounded, p.currency)}</span>
                </button>
              )
            })}
          </div>
        </section>

        {me && (
          <section className={`card stack share-me c-border-${me.person.color}`}>
            {meIsPayer ? (
              <div className="stack-s center-items">
                <div className="share-amount">你是先付的人 ⭐</div>
                <div className="muted small">下面可以看大家還了沒。</div>
              </div>
            ) : (
              <>
                <div className="center-items stack-xs">
                  <div className="muted small">你的份</div>
                  <div className="share-amount share-amount--big">{fmtMoney(me.totalRounded, p.currency)}</div>
                  {foreign && me.baseTotal != null && <div className="muted">≈ {fmtMoney(me.baseTotal, base)}</div>}
                  {me.exactBeforeRounding != null && <div className="muted small">（{fmtMoney(me.exactBeforeRounding, r.overchargeCurrency)} 進位到 {p.rounding}）</div>}
                  {me.lines.length > 0 && (
                    <button type="button" className="link small" onClick={() => setShowLines((v) => !v)}>
                      {showLines ? '收起明細' : `看明細（${me.lines.length} 項）`}
                    </button>
                  )}
                </div>
                {showLines && (
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

                {myTransfers.length === 0 && <p className="muted small center-text">你不用轉錢 🎉</p>}
                {myTransfers.map((t) => {
                  const to = nameOf(t.to)
                  const toOwner = t.to === ownerId
                  const reported = isReported(t)
                  const canPay = toOwner && pay && (pay.account || pay.linePay)
                  return (
                    <div key={t.key} className="pay-box stack-s">
                      {(r.multiPayer || t.paid > 0) && (
                        <div className="label">
                          轉給 {to?.emoji} {to?.name} <span className="strong">{fmtMoney(t.remaining, t.dueCurrency)}</span>
                          {t.paid > 0 && !t.settled && <span className="muted">（已還 {fmtMoney(t.paid, t.dueCurrency)}）</span>}
                        </div>
                      )}
                      {t.settled ? (
                        <div className="pill pill--mint center-self">✓ {to?.name} 已確認收到，謝謝！</div>
                      ) : reported ? (
                        <div className="stack-s center-items">
                          <div className="pill pill--mint">✅ 已回報「我轉了」{myNotes[t.key] ? `：${myNotes[t.key]}` : ''}</div>
                          <button type="button" className="link small" disabled={busy} onClick={() => report(t.key, 'unpaid')}>
                            按錯了，取消
                          </button>
                        </div>
                      ) : (
                        <>
                          {canPay ? (
                            <div className="stack-s">
                              {pay!.showTwqr !== false && pay!.bankCode && pay!.account && t.dueCurrency === 'TWD' && (() => {
                                const code = twqrTransfer({ bankCode: pay!.bankCode!, account: pay!.account!, amount: t.remaining, name: snap.ownerName })
                                return code ? (
                                  <div className="twqr">
                                    <QrCode text={code} size={168} />
                                    <div className="small">
                                      <div className="strong">🏦 銀行 App 掃這個</div>
                                      <div className="muted">台灣 Pay 或任一家銀行 App 的「掃碼轉帳」，帳號和 {fmtMoney(t.remaining, 'TWD')} 會自動帶入。</div>
                                    </div>
                                  </div>
                                ) : null
                              })()}
                              {pay!.account && (
                                <button type="button" className="pay-box__row" onClick={() => copy(`${pay!.bankCode ? pay!.bankCode + ' ' : ''}${pay!.account}`, '帳號')}>
                                  <span>
                                    🏦 {pay!.bankCode}
                                    {pay!.bankName ? ` ${pay!.bankName}` : ''}
                                  </span>
                                  <span className="strong">{pay!.account}</span>
                                  <span className="pill pill--pink">複製</span>
                                </button>
                              )}
                              {pay!.linePay && (
                                <a className="btn btn--mint" href={pay!.linePay} target="_blank" rel="noreferrer">
                                  💚 用 LINE Pay / 街口 轉帳
                                </a>
                              )}
                              {(pay!.quickPay ?? ['linepay', 'jkopay']).length > 0 && (
                                <div className="quickpay">
                                  {QUICK_PAY.filter((q) => (pay!.quickPay ?? ['linepay', 'jkopay']).includes(q.id)).map((q) => (
                                    <button
                                      key={q.id}
                                      type="button"
                                      className="btn btn--ghost btn--sm"
                                      onClick={() => {
                                        navigator.clipboard?.writeText(String(t.remaining)).catch(() => {})
                                        flash(`已複製 ${fmtMoney(t.remaining, t.dueCurrency)}，${q.hint}`)
                                        setTimeout(() => (location.href = q.scheme), 400)
                                      }}
                                    >
                                      {q.emoji} 開 {q.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                              {pay!.note && <div className="muted small">{pay!.note}</div>}
                            </div>
                          ) : (
                            <p className="muted small">{toOwner ? `${snap.ownerName} 還沒留轉帳資訊，直接問本人吧。` : `帳號直接問 ${to?.name} 吧。`}</p>
                          )}
                          <input className="input" placeholder="備註（選填）：LINE Pay、末五碼 12345…" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
                          <button type="button" className="btn btn--primary btn--lg btn--pulse" disabled={busy} onClick={() => report(t.key, 'paid')}>
                            💸 我轉了
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
                {myAllDone && <p className="muted small center-text">備註只有 {snap.ownerName} 看得到（用連結裡的金鑰加密）。</p>}
              </>
            )}
          </section>
        )}

        {/* progress */}
        <section className="card stack">
          <div className="row between center">
            <div className="section-title">大家的進度</div>
            <span className={`pill ${allDone ? 'pill--mint' : 'pill--pink'}`}>
              {r.transfers.length ? `${done}/${r.transfers.length}` : '—'} {allDone ? '收齊 🎉' : ''}
            </span>
          </div>
          {r.transfers.length > 0 && (
            <div className="progress">
              <div className="progress__bar" style={{ width: `${(done / r.transfers.length) * 100}%` }} />
            </div>
          )}
          <div className="stack-xs">
            {r.people.map((x) => {
              const fin = (r.multiPayer ? x.paid > 0 && r.transfers.every((t) => t.from !== x.person.id) : x.isPayer) || x.settled
              const reported = !fin && r.transfers.some((t) => t.from === x.person.id && !t.settled && isReported(t))
              return (
                <div key={x.person.id} className="line line--person">
                  <span className="row gap-s center">
                    <span className={`mini-avatar c-${x.person.color}`}>{x.person.emoji}</span>
                    {x.person.name}
                    {(r.multiPayer ? x.paid > 0 : x.isPayer) && <span className="pill pill--butter">⭐ {r.multiPayer ? `先付 ${fmtMoney(x.paid, p.currency)}` : '先付'}</span>}
                  </span>
                  <span className="row gap-s center">
                    <span className={fin ? 'muted' : 'strong'}>{fmtMoney(x.totalRounded, p.currency)}</span>
                    {x.settled ? <span title="已還">✅</span> : reported ? <span title="已回報轉帳">💸</span> : !fin && <span className="muted">⏳</span>}
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
    <div className="share-footer stack-s center-items">
      <a href="/" className="btn btn--ghost btn--sm">
        🐥 我也想用 BanBan 分帳
      </a>
      <p className="muted small center-text">這頁的內容只有拿到連結的人解得開，伺服器看不到金額。</p>
    </div>
  )
}
