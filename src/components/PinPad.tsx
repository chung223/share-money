import { useEffect, useState } from 'react'

export default function PinPad({ length = 4, onComplete, shake, disabled }: { length?: number; onComplete: (pin: string) => void; shake?: number; disabled?: boolean }) {
  const [pin, setPin] = useState('')
  useEffect(() => setPin(''), [shake])
  useEffect(() => {
    if (pin.length === length) {
      const p = pin
      const t = setTimeout(() => {
        onComplete(p)
        setPin('')
      }, 120)
      return () => clearTimeout(t)
    }
  }, [pin, length, onComplete])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < length ? p + e.key : p))
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [length, disabled])
  const push = (d: string) => !disabled && setPin((p) => (p.length < length ? p + d : p))
  return (
    <div className="pinpad">
      <div className={`pin-dots ${shake ? 'is-shake' : ''}`} key={shake}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={`pin-dot ${i < pin.length ? 'is-on' : ''}`} />
        ))}
      </div>
      <div className="pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => (
          <button
            key={i}
            type="button"
            className={`pin-key ${k === '' ? 'pin-key--blank' : ''}`}
            disabled={disabled || k === ''}
            onClick={() => (k === '⌫' ? setPin((p) => p.slice(0, -1)) : push(k))}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  )
}
