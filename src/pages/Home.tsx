import { useMemo } from 'react'
import { useStore } from '../store'
import { navigate } from '../router'
import { computeSplit, fmtMoney } from '../lib/split'
import { Empty, Mascot } from '../components/ui'
import type { Project } from '../lib/types'

const MODE_LABEL: Record<Project['mode'], string> = { equal: '均攤', items: '各點各的', mains: '主餐+共享' }

function ProjectCard({ p, base }: { p: Project; base: string }) {
  const r = useMemo(() => computeSplit(p), [p])
  const others = r.transfers
  const settledCount = others.filter((x) => x.settled).length
  const allSettled = others.length > 0 && settledCount === others.length
  const pending = others.filter((x) => !x.settled)
  return (
    <button type="button" className={`card project-card ${allSettled ? 'is-done' : ''}`} onClick={() => navigate(`/p/${p.id}`)}>
      <div className="project-card__emoji">{p.emoji}</div>
      <div className="project-card__body">
        <div className="project-card__name">{p.name || '未命名聚餐'}</div>
        <div className="project-card__meta">
          <span>{p.date}</span>
          <span className="dot">·</span>
          <span>{MODE_LABEL[p.mode]}</span>
          <span className="dot">·</span>
          <span>{p.people.length} 人</span>
        </div>
        <div className="project-card__people">
          {p.people.slice(0, 6).map((x) => (
            <span key={x.id} className={`mini-avatar c-${x.color}`}>
              {x.emoji}
            </span>
          ))}
          {p.people.length > 6 && <span className="mini-avatar mini-avatar--more">+{p.people.length - 6}</span>}
        </div>
      </div>
      <div className="project-card__right">
        <div className="project-card__total">{fmtMoney(r.grandTotalRounded, p.currency)}</div>
        {r.baseGrandTotal != null && p.currency !== base && <div className="project-card__base">≈ {fmtMoney(r.baseGrandTotal, base)}</div>}
        <div className={`pill ${allSettled ? 'pill--mint' : pending.length ? 'pill--pink' : 'pill--grey'}`}>
          {allSettled ? '✓ 已結清' : others.length ? `${settledCount}/${others.length} ${r.multiPayer ? '轉帳' : '收款'}` : '只有自己'}
        </div>
      </div>
    </button>
  )
}

export default function Home() {
  const projects = useStore((s) => s.data.projects)
  const base = useStore((s) => s.data.baseCurrency)
  const addProject = useStore((s) => s.addProject)
  const encrypted = useStore((s) => s.encrypted)
  const lock = useStore((s) => s.lock)

  const me = useStore((s) => s.data.me.id)
  const totalOwed = useMemo(() => {
    let sum = 0
    for (const p of projects) {
      const r = computeSplit(p)
      for (const t of r.transfers) {
        if (t.settled) continue
        // money coming back to me (or to whoever paid, when I'm not in the project)
        const toMe = t.to === me || (!p.people.some((x) => x.id === me) && t.to === p.payerId)
        if (!toMe) continue
        sum += t.baseAmount ?? (p.currency === base ? t.amount : 0)
      }
    }
    return sum
  }, [projects, base, me])

  const create = () => {
    const p = addProject()
    navigate(`/p/${p.id}`)
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <Mascot size={40} />
          <div>
            <div className="brand__name">반반 BanBan</div>
            <div className="brand__sub">半半分帳 · 你先付，我來算</div>
          </div>
        </div>
        <div className="row gap-s">
          {encrypted && (
            <button type="button" className="icon-btn" title="上鎖" onClick={lock}>
              🔒
            </button>
          )}
          <button type="button" className="icon-btn" title="設定" onClick={() => navigate('/settings')}>
            ⚙️
          </button>
        </div>
      </header>

      {projects.length > 0 && (
        <div className="hero-stat card card--pink">
          <div>
            <div className="hero-stat__label">還沒收回來的錢</div>
            <div className="hero-stat__value">{fmtMoney(totalOwed, base)}</div>
          </div>
          <div className="hero-stat__emoji">{totalOwed > 0 ? '🥺' : '🎉'}</div>
        </div>
      )}

      <main className="stack">
        {projects.length === 0 ? (
          <Empty title="還沒有帳本呢" hint="聚餐、外送、計程車，每一餐都是一個小專案。">
            <button type="button" className="btn btn--primary btn--lg" onClick={create}>
              ＋ 開一個新帳本
            </button>
          </Empty>
        ) : (
          projects.map((p) => <ProjectCard key={p.id} p={p} base={base} />)
        )}
      </main>

      {projects.length > 0 && (
        <button type="button" className="fab" onClick={create} aria-label="新增帳本">
          ＋
        </button>
      )}
    </div>
  )
}
