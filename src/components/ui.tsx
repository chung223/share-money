import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Person } from '../lib/types'
import { evalMoney, looksLikeExpression } from '../lib/expr'

export function Mascot({ size = 120, mood = 'happy', className = '' }: { size?: number; mood?: 'happy' | 'sleepy' | 'wow' | 'sad'; className?: string }) {
  // 반반이: a half-pink, half-mint rice ball friend.
  return (
    <svg className={`mascot ${className}`} width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <clipPath id="mascot-clip">
          <path d="M60 14 C 90 14, 108 40, 108 66 C 108 92, 88 108, 60 108 C 32 108, 12 92, 12 66 C 12 40, 30 14, 60 14 Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#mascot-clip)">
        <rect x="0" y="0" width="60" height="120" fill="var(--c-pink)" />
        <rect x="60" y="0" width="60" height="120" fill="var(--c-mint)" />
        <path d="M60 14 C 90 14, 108 40, 108 66 C 108 92, 88 108, 60 108 C 32 108, 12 92, 12 66 C 12 40, 30 14, 60 14 Z" fill="none" stroke="var(--mascot-line)" strokeWidth="4" />
      </g>
      <path d="M60 14 C 90 14, 108 40, 108 66 C 108 92, 88 108, 60 108 C 32 108, 12 92, 12 66 C 12 40, 30 14, 60 14 Z" fill="none" stroke="var(--mascot-line)" strokeWidth="4" />
      {mood === 'sleepy' ? (
        <>
          <path d="M40 62 q6 4 12 0" stroke="var(--mascot-line)" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M68 62 q6 4 12 0" stroke="var(--mascot-line)" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      ) : mood === 'wow' ? (
        <>
          <circle cx="46" cy="60" r="5" fill="var(--mascot-line)" />
          <circle cx="74" cy="60" r="5" fill="var(--mascot-line)" />
          <ellipse cx="60" cy="80" rx="6" ry="7" fill="var(--mascot-line)" />
        </>
      ) : mood === 'sad' ? (
        <>
          <circle cx="46" cy="62" r="4" fill="var(--mascot-line)" />
          <circle cx="74" cy="62" r="4" fill="var(--mascot-line)" />
          <path d="M50 84 q10 -8 20 0" stroke="var(--mascot-line)" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="46" cy="62" r="4" fill="var(--mascot-line)" />
          <circle cx="74" cy="62" r="4" fill="var(--mascot-line)" />
          <path d="M52 78 q8 8 16 0" stroke="var(--mascot-line)" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      )}
      <circle cx="34" cy="74" r="6" fill="var(--blush)" opacity="0.8" />
      <circle cx="86" cy="74" r="6" fill="var(--blush)" opacity="0.8" />
      <path d="M60 14 v-6" stroke="var(--mascot-line)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="5" r="4" fill="var(--c-butter)" stroke="var(--mascot-line)" strokeWidth="3" />
    </svg>
  )
}

export function Avatar({ person, size = 36, active = true, onClick, title }: { person: Person; size?: number; active?: boolean; onClick?: () => void; title?: string }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`avatar c-${person.color} ${active ? '' : 'avatar--off'}`}
      style={{ width: size, height: size, fontSize: size * 0.52 }}
      onClick={onClick}
      title={title ?? person.name}
      aria-label={person.name}
    >
      {person.emoji}
    </Tag>
  )
}

export function Sheet({ open, onClose, title, children, tall }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; tall?: boolean }) {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) setMounted(true)
    else {
      const t = setTimeout(() => setMounted(false), 220)
      return () => clearTimeout(t)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    document.body.classList.add('no-scroll')
    return () => {
      removeEventListener('keydown', onKey)
      document.body.classList.remove('no-scroll')
    }
  }, [open, onClose])
  if (!mounted) return null
  return createPortal(
    <div className={`sheet-backdrop ${open ? 'is-open' : ''}`} onClick={onClose}>
      <div className={`sheet ${tall ? 'sheet--tall' : ''}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />
        {title && <div className="sheet__title">{title}</div>}
        <div className="sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={`seg__btn ${o.value === value ? 'is-on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EmojiPicker({ value, options, onChange }: { value: string; options: string[]; onChange: (e: string) => void }) {
  return (
    <div className="emoji-grid">
      {options.map((e) => (
        <button key={e} type="button" className={`emoji-grid__btn ${e === value ? 'is-on' : ''}`} onClick={() => onChange(e)}>
          {e}
        </button>
      ))}
    </div>
  )
}

/** 金額欄，順便是小算盤：打 120+80、300/2、(300+50)/2，離開欄位或按 Enter 就算好。 */
export function MoneyInput({ value, onChange, placeholder = '0', autoFocus, className = '' }: { value: number; onChange: (n: number) => void; placeholder?: string; autoFocus?: boolean; className?: string }) {
  const [text, setText] = useState(value ? String(value) : '')
  const last = useRef(value)
  useEffect(() => {
    if (value !== last.current) {
      last.current = value
      setText(value ? String(value) : '')
    }
  }, [value])
  const commit = (t: string) => {
    if (!looksLikeExpression(t)) return
    const v = evalMoney(t)
    if (v == null) return
    last.current = v
    setText(v ? String(v) : '')
    onChange(v)
  }
  const isExpr = looksLikeExpression(text)
  const preview = isExpr ? evalMoney(text) : null
  return (
    <span className={`money-wrap ${/\bgrow\b/.test(className) ? 'grow' : ''} ${/\binput--qty\b/.test(className) ? 'money-wrap--wide' : ''}`}>
      <input
        className={`input input--money ${className.replace(/\b(grow|input--qty)\b/g, '')} ${isExpr ? 'input--expr' : ''}`}
        inputMode="decimal"
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.\-+*/()×÷xX,\s]/g, '')
          setText(t)
          if (looksLikeExpression(t)) return // wait for blur / Enter
          const n = parseFloat(t.replace(/,/g, ''))
          const v = Number.isFinite(n) ? n : 0
          last.current = v
          onChange(v)
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === '=') {
            e.preventDefault()
            commit((e.target as HTMLInputElement).value)
          }
        }}
        onFocus={(e) => e.target.select()}
      />
      {isExpr && <span className="money-wrap__hint">{preview != null ? `= ${preview}` : '…'}</span>}
    </span>
  )
}

export function Confetti({ on }: { on: boolean }) {
  if (!on) return null
  const bits = Array.from({ length: 24 }, (_, i) => i)
  const emojis = ['🎉', '✨', '💖', '🍀', '⭐', '🎊']
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((i) => (
        <span key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * 0.12}s`, animationDuration: `${1.6 + (i % 4) * 0.3}s` }}>
          {emojis[i % emojis.length]}
        </span>
      ))}
    </div>
  )
}

export function Empty({ mood = 'happy', title, hint, children }: { mood?: 'happy' | 'sleepy' | 'wow' | 'sad'; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Mascot size={110} mood={mood} className="mascot--float" />
      <div className="empty__title">{title}</div>
      {hint && <div className="empty__hint">{hint}</div>}
      {children}
    </div>
  )
}
