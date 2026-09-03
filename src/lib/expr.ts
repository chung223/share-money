/** 金額欄的小算盤：支援 + - * / 括號與小數，例如 "120+80"、"(300+50)/2"。不合法回傳 null。 */
export function evalMoney(text: string): number | null {
  const s = text.replace(/[，,]/g, '').replace(/[×xX]/g, '*').replace(/[÷]/g, '/').replace(/\s+/g, '')
  if (!s || !/^[\d.+\-*/()]+$/.test(s)) return null
  let i = 0
  const peek = () => s[i]
  const num = (): number => {
    if (peek() === '(') {
      i++
      const v = expr()
      if (peek() !== ')') throw new Error('paren')
      i++
      return v
    }
    if (peek() === '-') {
      i++
      return -num()
    }
    const m = /^\d*\.?\d+/.exec(s.slice(i))
    if (!m) throw new Error('num')
    i += m[0].length
    return parseFloat(m[0])
  }
  const term = (): number => {
    let v = num()
    while (peek() === '*' || peek() === '/') {
      const op = s[i++]
      const r = num()
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  const expr = (): number => {
    let v = term()
    while (peek() === '+' || peek() === '-') {
      const op = s[i++]
      const r = term()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  try {
    const v = expr()
    if (i !== s.length || !Number.isFinite(v)) return null
    return Math.round(v * 100) / 100
  } catch {
    return null
  }
}

export function looksLikeExpression(text: string) {
  return /[+\-*/×÷xX()]/.test(text.replace(/^-/, ''))
}
