import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { navigate } from '../router'
import { parseTripSecret, type TripBundle } from '../lib/tripSync'
import { fmtMoney, computeSplit } from '../lib/split'
import { Avatar, Empty, Mascot } from '../components/ui'

/** 收到共編連結：拉旅程、解密、選自己是誰、加入。 */
export default function JoinTripPage({ id, secret }: { id: string; secret: string }) {
  const previewTrip = useStore((s) => s.previewTrip)
  const joinTrip = useStore((s) => s.joinTrip)
  const me = useStore((s) => s.data.me)
  const already = useStore((s) => s.data.trips?.find((t) => t.share?.id === id))
  const showToast = useStore((s) => s.showToast)
  const [bundle, setBundle] = useState<TripBundle | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [who, setWho] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (already) {
      navigate(`/t/${already.id}`, true)
      return
    }
    const s = parseTripSecret(secret)
    if (!s) {
      setErr('連結不完整（金鑰缺了）')
      return
    }
    previewTrip(id, s).then(setBundle).catch((e) => setErr(e instanceof Error ? e.message : '打不開'))
  }, [id, secret, already, previewTrip])

  const people = bundle ? [...new Map(bundle.projects.flatMap((p) => p.people).map((x) => [x.id, x])).values()] : []
  const base = useStore((s) => s.data.baseCurrency)
  const total = bundle ? bundle.projects.reduce((a, p) => a + (p.currency === base ? computeSplit(p, base).grandTotalRounded : 0), 0) : 0

  const join = async () => {
    setBusy(true)
    try {
      const tid = await joinTrip(id, parseTripSecret(secret)!, who === 'new' ? null : who, who === 'new')
      showToast('加入了，一起記吧', '👥')
      navigate(`/t/${tid}`, true)
    } catch (e) {
      showToast(e instanceof Error ? e.message : '加入失敗', '😵')
    } finally {
      setBusy(false)
    }
  }

  if (err) {
    return (
      <div className="page">
        <Empty mood="sad" title="加不進去" hint={err}>
          <button type="button" className="btn btn--primary" onClick={() => navigate('/', true)}>
            回首頁
          </button>
        </Empty>
      </div>
    )
  }
  if (!bundle) {
    return (
      <div className="splash">
        <Mascot size={96} className="mascot--float" />
        <div className="splash__name">讀取旅程…</div>
      </div>
    )
  }
  return (
    <div className="page">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => navigate('/', true)} aria-label="返回">
          ←
        </button>
        <h1 className="topbar__title">加入旅程</h1>
        <span style={{ width: 40 }} />
      </header>
      <main className="stack">
        <div className="card card--pink total-card">
          <div>
            <div className="total-card__label">有人邀你一起記帳</div>
            <div className="total-card__value" style={{ fontSize: 26 }}>
              {bundle.trip.emoji} {bundle.trip.name}
            </div>
            <div className="total-card__payer">
              {bundle.projects.length} 本帳 · {people.length} 人{total ? ` · 共 ${fmtMoney(total, base)}` : ''}
            </div>
          </div>
          <div className="total-card__emoji">🧳</div>
        </div>
        <section className="card stack">
          <div className="section-title">你是哪一位？</div>
          <p className="muted small">選了之後，結算會用你的視角顯示「誰欠你、你欠誰」。</p>
          <div className="friend-grid">
            {people.map((x) => (
              <button key={x.id} type="button" className={`friend ${who === x.id ? 'is-on' : ''}`} onClick={() => setWho(x.id)}>
                <Avatar person={x} size={48} active={!who || who === x.id} />
                <span>{x.name}</span>
              </button>
            ))}
            <button type="button" className={`friend ${who === 'new' ? 'is-on' : ''}`} onClick={() => setWho('new')}>
              <Avatar person={me} size={48} active={!who || who === 'new'} />
              <span>我不在名單（{me.name}）</span>
            </button>
          </div>
        </section>
        <button type="button" className="btn btn--primary btn--lg" disabled={!who || busy} onClick={join}>
          {busy ? '加入中…' : '加入這趟旅程 →'}
        </button>
        <p className="muted small center-text">加入後這趟的帳本會存在你的裝置，改動會自動跟大家同步。同行的人會存成你的常用朋友。</p>
      </main>
    </div>
  )
}
