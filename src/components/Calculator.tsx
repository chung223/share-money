import { useEffect, useMemo, useState } from 'react'
import { evalMoney as evaluate } from '../lib/expr'
import { getCalcTarget, subscribeCalcTarget } from '../lib/calcTarget'
import { fmtMoney } from '../lib/split'
import { Sheet } from './ui'
import { useStore } from '../store'

export interface CalcContext {
  currency: string
  base: string
  rate: number | null
  chips: { label: string; value: number }[]
}

interface TapeLine {
  expr: string
  result: number
}
// Keep the tape across opens so「剛剛算過什麼」survives closing the sheet.
let tapeMemory: TapeLine[] = []

const KEYS: string[][] = [
  ['AC', '(', ')', '⌫'],
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '−'],
  ['0', '.', '%', '+'],
]

export default function Calculator({ open, onClose, ctx }: { open: boolean; onClose: () => void; ctx: CalcContext }) {
  const [expr, setExpr] = useState('')
  const [tape, setTape] = useState<TapeLine[]>(tapeMemory)
  const [, bump] = useState(0)
  const showToast = useStore((s) => s.showToast)
  useEffect(() => subscribeCalcTarget(() => bump((n) => n + 1)), [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (/^[\d.+\-*/()%]$/.test(e.key)) setExpr((x) => x + e.key)
      else if (e.key === 'Enter' || e.key === '=') equals()
      else if (e.key === 'Backspace') setExpr((x) => x.slice(0, -1))
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expr])

  const result = useMemo(() => (expr ? evaluate(expr) : null), [expr])
  const target = getCalcTarget()
  const foreign = ctx.rate != null && ctx.currency !== ctx.base

  const press = (k: string) => {
    if (navigator.vibrate) navigator.vibrate(8)
    if (k === 'AC') return setExpr('')
    if (k === '⌫') return setExpr((x) => x.slice(0, -1))
    setExpr((x) => x + k)
  }
  const equals = () => {
    if (result == null || !expr) return
    const line = { expr, result }
    tapeMemory = [line, ...tapeMemory].slice(0, 12)
    setTape(tapeMemory)
    setExpr(String(result))
  }
  const insert = (n: number) => setExpr((x) => (x && /[\d)%]$/.test(x) ? x + '×' + n : x + n))
  const fill = () => {
    if (result == null || !target) return
    target.apply(result)
    showToast(`已填入 ${target.label}`, '🧮')
    setExpr('')
    onClose()
  }
  const copy = async () => {
    if (result == null) return
    try {
      await navigator.clipboard.writeText(String(result))
      showToast('已複製', '📋')
    } catch {
      /* ignore */
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="🧮 小算盤">
      <div className="calc">
        <div className="calc__tape">
          {tape.length === 0 && <div className="muted small">算過的都會留在這裡，方便回頭對。</div>}
          {tape.map((l, i) => (
            <button key={i} type="button" className="calc__tape-line" onClick={() => setExpr(String(l.result))} title="點一下帶回">
              <span className="muted">{l.expr}</span>
              <span className="strong">= {l.result.toLocaleString()}</span>
            </button>
          ))}
        </div>
        <div className={`calc__display ${result == null && expr ? 'is-bad' : ''}`}>
          <div className="calc__expr">{expr || <span className="muted">0</span>}</div>
          <div className="calc__result">{result != null ? result.toLocaleString() : expr ? '…' : ''}</div>
          {foreign && result != null && (
            <div className="calc__fx">
              {fmtMoney(result, ctx.currency)} ≈ {fmtMoney(result * ctx.rate!, ctx.base)} · {fmtMoney(result, ctx.base)} ≈ {fmtMoney(result / ctx.rate!, ctx.currency)}
            </div>
          )}
        </div>
        {ctx.chips.length > 0 && (
          <div className="chip-row">
            {ctx.chips.map((c) => (
              <button key={c.label} type="button" className="chip chip--xs" onClick={() => insert(c.value)}>
                {c.label} {c.value.toLocaleString()}
              </button>
            ))}
            {foreign && (
              <>
                <button type="button" className="chip chip--xs" onClick={() => setExpr((x) => (x ? `(${x})×${ctx.rate}` : ''))}>
                  → {ctx.base}
                </button>
                <button type="button" className="chip chip--xs" onClick={() => setExpr((x) => (x ? `(${x})÷${ctx.rate}` : ''))}>
                  → {ctx.currency}
                </button>
              </>
            )}
          </div>
        )}
        <div className="calc__keys">
          {KEYS.flat().map((k) => (
            <button key={k} type="button" className={`calc__key ${/[÷×−+]/.test(k) ? 'calc__key--op' : ''} ${k === 'AC' || k === '⌫' ? 'calc__key--fn' : ''}`} onClick={() => press(k)}>
              {k}
            </button>
          ))}
          <button type="button" className="calc__key calc__key--eq" onClick={equals} disabled={result == null}>
            =
          </button>
        </div>
        <div className="row gap">
          <button type="button" className="btn btn--ghost" disabled={result == null} onClick={copy}>
            📋 複製
          </button>
          <button type="button" className="btn btn--primary grow" disabled={result == null || !target} onClick={fill}>
            {target ? `填入「${target.label}」` : '先點一個金額欄位'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
