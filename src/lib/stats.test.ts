import { describe, expect, it } from 'vitest'
import { guessCategory } from './category'
import { monthKey, monthRange, monthStats, shiftMonth } from './stats'
import type { Project } from './types'

const A = { id: 'me', name: '我', emoji: '🐥', color: 'pink' }
const B = { id: 'b', name: '小B', emoji: '🐰', color: 'mint' }
const C = { id: 'c', name: '小C', emoji: '🐻', color: 'butter' }

function proj(over: Partial<Project> & { total: number }): Project {
  const { total, ...rest } = over
  return {
    id: Math.random().toString(36).slice(2),
    name: 't',
    emoji: '🍜',
    date: '2026-09-03',
    createdAt: 0,
    updatedAt: 0,
    currency: 'TWD',
    rate: null,
    mode: 'equal',
    payerId: 'me',
    people: [A, B, C],
    items: [{ id: 'i', name: '總額', price: total, qty: 1, sharedBy: 'all', kind: 'shared' }],
    extras: [],
    settled: {},
    ...rest,
  }
}

describe('guessCategory', () => {
  it('explicit > emoji > other', () => {
    expect(guessCategory({ emoji: '🚕' })).toBe('transport')
    expect(guessCategory({ emoji: '🍜', category: 'shopping' })).toBe('shopping')
    expect(guessCategory({ emoji: '🤷' })).toBe('other')
  })
})

describe('month helpers', () => {
  it('monthKey / shiftMonth', () => {
    expect(monthKey('2026-09-03')).toBe('2026-09')
    expect(monthKey('')).toBe('')
    expect(monthKey('2026-13-01')).toBe('')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })
  it('range always contains today', () => {
    expect(monthRange([], '2026-11-24')).toEqual({ min: '2026-11', max: '2026-11' })
    expect(monthRange([proj({ total: 1, date: '2026-03-01' })], '2026-11-24')).toEqual({ min: '2026-03', max: '2026-11' })
  })
})

describe('monthStats', () => {
  it('sums what others owe me, by category and friend', () => {
    const ps = [
      proj({ total: 900 }), // 吃飯：B、C 各欠 300（我自己那份不算）
      proj({ total: 600, emoji: '🚕', people: [A, B] }), // 交通：B 欠 300
      proj({ total: 999, date: '2026-10-01' }), // 別的月
      proj({ total: 300, payerId: 'b' }), // 別人付，我不是代墊的人
    ]
    const s = monthStats(ps, 'me', 'TWD', '2026-09')
    expect(s.total).toBe(900)
    expect(s.projectCount).toBe(2)
    expect(s.categories.map((c) => [c.id, c.total])).toEqual([['food', 600], ['transport', 300]])
    expect(s.friends.find((f) => f.person.id === 'b')).toMatchObject({ total: 600, count: 2 })
    expect(s.friends.find((f) => f.person.id === 'c')?.total).toBe(300)
  })
  it('settled money drops out of remaining and ranking follows remaining', () => {
    const p = proj({ total: 900 })
    p.settled['b_me'] = true
    const s = monthStats([p], 'me', 'TWD', '2026-09')
    expect(s.total).toBe(600)
    expect(s.remaining).toBe(300)
    expect(s.friends[0].person.id).toBe('c')
  })
  it('foreign currency without conversion is counted aside', () => {
    const s = monthStats([proj({ total: 3000, currency: 'JPY', rate: null })], 'me', 'TWD', '2026-09')
    expect(s.total).toBe(0)
    expect(s.foreignCount).toBe(2)
  })
  it('empty month', () => {
    const s = monthStats([], 'me', 'TWD', '2026-09')
    expect(s).toMatchObject({ total: 0, projectCount: 0, categories: [], friends: [] })
  })
})
