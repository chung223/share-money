/**
 * Tiny, safe arithmetic evaluator for money fields and the in-app calculator.
 * Supports + - * / ( ) %, unary minus, decimals and thousands separators.
 * Also accepts × ÷ and full-width digits/operators from mobile keyboards.
 */
export function normalizeExpr(src: string): string {
  return src
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[×xX]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[－−–]/g, '-')
    .replace(/[＋]/g, '+')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[．]/g, '.')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
}

/** True when the text contains something beyond a plain number. */
export function isExpression(src: string): boolean {
  const s = normalizeExpr(src)
  return /[+*/()%]/.test(s) || /\d-/.test(s)
}

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string }

function tokenize(s: string): Tok[] | null {
  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      const n = Number(s.slice(i, j))
      if (!Number.isFinite(n)) return null
      out.push({ t: 'num', v: n })
      i = j
      continue
    }
    if ('+-*/()%'.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    return null
  }
  return out
}

/** Recursive-descent parser. Returns null on any syntax error. */
export function evaluate(src: string): number | null {
  const s = normalizeExpr(src)
  if (!s) return null
  const toks = tokenize(s)
  if (!toks) return null
  let p = 0
  const peek = () => toks[p]
  const next = () => toks[p++]

  function primary(): number | null {
    const t = next()
    if (!t) return null
    if (t.t === 'num') {
      let v = t.v
      // postfix percent: 10% => 0.1
      while (peek()?.t === 'op' && peek().v === '%') {
        next()
        v = v / 100
      }
      return v
    }
    if (t.v === '(') {
      const v = expr()
      const close = next()
      if (v == null || !close || close.t !== 'op' || close.v !== ')') return null
      return v
    }
    if (t.v === '-') {
      const v = primary()
      return v == null ? null : -v
    }
    if (t.v === '+') return primary()
    return null
  }
  function term(): number | null {
    let v = primary()
    if (v == null) return null
    while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/')) {
      const op = next().v
      const r = primary()
      if (r == null) return null
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  function expr(): number | null {
    let v = term()
    if (v == null) return null
    while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = next().v
      const r = term()
      if (r == null) return null
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  const v = expr()
  if (v == null || p !== toks.length || !Number.isFinite(v)) return null
  return Math.round(v * 10000) / 10000
}
