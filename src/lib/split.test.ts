import { describe, expect, it } from 'vitest'
import { computeSplit, distributeRounding } from './split'
import type { Project } from './types'

const base: Project = {
  id: 'p',
  name: 'test',
  emoji: '🍜',
  date: '2026-09-03',
  createdAt: 0,
  updatedAt: 0,
  currency: 'TWD',
  rate: null,
  mode: 'equal',
  payerId: 'a',
  people: [
    { id: 'a', name: 'A', emoji: '🐥', color: 'pink' },
    { id: 'b', name: 'B', emoji: '🐰', color: 'mint' },
    { id: 'c', name: 'C', emoji: '🐻', color: 'butter' },
  ],
  items: [],
  extras: [],
  settled: {},
}

describe('distributeRounding', () => {
  it('keeps the sum equal to the rounded total', () => {
    const out = distributeRounding([33.3333, 33.3333, 33.3333], 0)
    expect(out.reduce((a, b) => a + b, 0)).toBe(100)
    expect(out.sort()).toEqual([33, 33, 34])
  })
  it('works with 2 decimals', () => {
    const out = distributeRounding([10 / 3, 10 / 3, 10 / 3], 2)
    expect(Math.round(out.reduce((a, b) => a + b, 0) * 100)).toBe(1000)
  })
})

describe('computeSplit', () => {
  it('equal mode splits everything evenly regardless of assignment', () => {
    const p: Project = { ...base, items: [{ id: 'i1', name: '總額', price: 1000, qty: 1, sharedBy: ['a'], kind: 'shared' }] }
    const r = computeSplit(p)
    expect(r.people.map((x) => x.totalRounded)).toEqual([334, 333, 333])
    expect(r.grandTotalRounded).toBe(1000)
  })

  it('items mode assigns to the listed sharers', () => {
    const p: Project = {
      ...base,
      mode: 'items',
      items: [
        { id: 'i1', name: '拉麵', price: 300, qty: 1, sharedBy: ['a'], kind: 'main' },
        { id: 'i2', name: '餃子', price: 120, qty: 1, sharedBy: ['b', 'c'], kind: 'shared' },
        { id: 'i3', name: '啤酒', price: 90, qty: 2, sharedBy: 'all', kind: 'shared' },
      ],
    }
    const r = computeSplit(p)
    expect(r.people.map((x) => x.totalRounded)).toEqual([360, 120, 120])
    expect(r.itemsTotal).toBe(600)
  })

  it('extras: percent proportional and fixed equal', () => {
    const p: Project = {
      ...base,
      mode: 'items',
      items: [
        { id: 'i1', name: 'A主餐', price: 300, qty: 1, sharedBy: ['a'], kind: 'main' },
        { id: 'i2', name: 'B主餐', price: 100, qty: 1, sharedBy: ['b'], kind: 'main' },
      ],
      people: base.people.slice(0, 2),
      extras: [
        { id: 'e1', name: '服務費', emoji: '🧾', type: 'percent', value: 10, split: 'proportional' },
        { id: 'e2', name: '外送費', emoji: '🛵', type: 'fixed', value: 60, split: 'equal' },
      ],
    }
    const r = computeSplit(p)
    // A: 300 + 30 + 30 = 360, B: 100 + 10 + 30 = 140
    expect(r.people.map((x) => x.totalRounded)).toEqual([360, 140])
    expect(r.grandTotalRounded).toBe(500)
  })

  it('converts to base currency with drift-free rounding', () => {
    const p: Project = {
      ...base,
      currency: 'JPY',
      rate: 0.2137,
      items: [{ id: 'i1', name: '壽司', price: 10000, qty: 1, sharedBy: 'all', kind: 'shared' }],
    }
    const r = computeSplit(p)
    expect(r.baseGrandTotal).toBe(2137)
    expect(r.people.reduce((a, x) => a + (x.baseTotal ?? 0), 0)).toBe(2137)
  })

  it('reports unassigned items', () => {
    const p: Project = { ...base, mode: 'items', items: [{ id: 'i1', name: '孤兒', price: 50, qty: 1, sharedBy: [], kind: 'shared' }] }
    const r = computeSplit(p)
    expect(r.unassigned.length).toBe(1)
    expect(r.grandTotal).toBe(0)
  })
})
