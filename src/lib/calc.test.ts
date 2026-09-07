import { describe, expect, it } from 'vitest'
import { evaluate, isExpression } from './calc'

describe('evaluate', () => {
  it('handles basic arithmetic with precedence', () => {
    expect(evaluate('120*2+30')).toBe(270)
    expect(evaluate('1280/4')).toBe(320)
    expect(evaluate('(100+50)*2')).toBe(300)
    expect(evaluate('10-3-2')).toBe(5)
    expect(evaluate('-5+10')).toBe(5)
  })
  it('accepts mobile / full-width symbols and thousands separators', () => {
    expect(evaluate('1,280 × 2')).toBe(2560)
    expect(evaluate('１２０＋３０')).toBe(150)
    expect(evaluate('900 ÷ 3')).toBe(300)
  })
  it('supports percent', () => {
    expect(evaluate('1000*10%')).toBe(100)
    expect(evaluate('1000+1000*10%')).toBe(1100)
  })
  it('returns null on garbage', () => {
    expect(evaluate('')).toBeNull()
    expect(evaluate('abc')).toBeNull()
    expect(evaluate('1+')).toBeNull()
    expect(evaluate('(1+2')).toBeNull()
    expect(evaluate('1/0')).toBeNull()
  })
  it('isExpression', () => {
    expect(isExpression('120')).toBe(false)
    expect(isExpression('1,280')).toBe(false)
    expect(isExpression('120*2')).toBe(true)
    expect(isExpression('100-20')).toBe(true)
    expect(isExpression('-20')).toBe(false)
  })
})
