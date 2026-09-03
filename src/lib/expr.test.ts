import { describe, expect, it } from 'vitest'
import { evalMoney, looksLikeExpression } from './expr'
import { personBalances } from './balances'
import type { Project } from './types'

describe('evalMoney', () => {
  it('does the four operations with precedence and parens', () => {
    expect(evalMoney('120+80')).toBe(200)
    expect(evalMoney('300/2')).toBe(150)
    expect(evalMoney('(300+50)/2')).toBe(175)
    expect(evalMoney('1,200*1.1')).toBe(1320)
    expect(evalMoney('100-30*2')).toBe(40)
    expect(evalMoney('10÷4')).toBe(2.5)
    expect(evalMoney('3x4')).toBe(12)
    expect(evalMoney('-50+100')).toBe(50)
  })
  it('rejects garbage', () => {
    expect(evalMoney('abc')).toBeNull()
    expect(evalMoney('1+')).toBeNull()
    expect(evalMoney('(1+2')).toBeNull()
    expect(evalMoney('1/0')).toBeNull()
    expect(evalMoney('')).toBeNull()
  })
  it('detects expressions', () => {
    expect(looksLikeExpression('120+80')).toBe(true)
    expect(looksLikeExpression('120')).toBe(false)
    expect(looksLikeExpression('-120')).toBe(false)
  })
})

describe('personBalances', () => {
  const me = { id: 'me', name: '我', emoji: '🐥', color: 'butter' }
  const ming = { id: 'm', name: '小明', emoji: '🐰', color: 'mint' }
  const hua = { id: 'h', name: '小華', emoji: '🐻', color: 'sky' }
  const proj = (id: string, date: string, extra: Partial<Project>): Project => ({ id, name: id, emoji: '🍜', date, createdAt: 1, updatedAt: 1, currency: 'TWD', rate: null, mode: 'equal', payerId: 'me', people: [me, ming, hua], items: [{ id: 'i', name: '總額', price: 300, qty: 1, sharedBy: 'all', kind: 'shared' }], extras: [], settled: {}, ...extra })
  it('sums unsettled transfers per person across projects and nets both directions', () => {
    const projects = [
      proj('a', '2026-09-01', {}), // ming 100, hua 100 owe me
      proj('b', '2026-09-02', { settled: { m: true } }), // only hua 100
      proj('c', '2026-09-03', { payerId: 'm', people: [me, ming] }), // I owe ming 150
      proj('d', '2026-09-04', { currency: 'JPY', rate: null }), // foreign without rate: listed, not summed
      proj('e', '2026-09-05', { partial: { h_me: 40 } }), // hua remaining 60
    ]
    const b = personBalances(projects, 'me', 'TWD')
    const hu = b.find((x) => x.person.id === 'h')!
    const mi = b.find((x) => x.person.id === 'm')!
    expect(hu.owesMe).toBe(260)
    expect(hu.net).toBe(260)
    expect(hu.foreign).toHaveLength(1)
    expect(mi.owesMe).toBe(200) // a + e (b is settled)
    expect(mi.iOwe).toBe(150)
    expect(mi.net).toBe(50)
    expect(b[0].person.id).toBe('h') // sorted by net desc
    expect(hu.lines[0].project.id).toBe('e') // newest first
  })
})
