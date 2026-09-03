import { describe, expect, it } from 'vitest'
import { computeSplit, distributeRounding, simplifyDebts } from './split'
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

describe('multi-payer + simplifyDebts', () => {
  const items = [{ id: 'i1', name: '總額', price: 900, qty: 1, sharedBy: 'all' as const, kind: 'shared' as const }]
  it('single payer: one transfer per non-payer, legacy settled keys still work', () => {
    const r = computeSplit({ ...base, items, settled: { b: true } })
    expect(r.multiPayer).toBe(false)
    expect(r.transfers.map((t) => [t.from, t.to, t.amount, t.settled])).toEqual([
      ['b', 'a', 300, true],
      ['c', 'a', 300, false],
    ])
    expect(r.people.map((x) => [x.paid, x.net, x.settled])).toEqual([
      [900, 600, true],
      [0, -300, true],
      [0, -300, false],
    ])
    expect(r.paymentsDiff).toBe(0)
  })
  it('two payers: nets and a minimal transfer set', () => {
    // A paid 600, C paid 300; everyone owes 300 -> only B pays A 300
    const r = computeSplit({ ...base, items, payments: [{ personId: 'a', amount: 600 }, { personId: 'c', amount: 300 }] })
    expect(r.multiPayer).toBe(true)
    expect(r.people.map((x) => x.net)).toEqual([300, -300, 0])
    expect(r.transfers.map((t) => [t.from, t.to, t.amount])).toEqual([['b', 'a', 300]])
    expect(r.people[1].settled).toBe(false)
    expect(computeSplit({ ...base, items, payments: [{ personId: 'a', amount: 600 }, { personId: 'c', amount: 300 }], settled: { b_a: true } }).people[1].settled).toBe(true)
  })
  it('reports when payments do not add up', () => {
    const r = computeSplit({ ...base, items, payments: [{ personId: 'a', amount: 500 }] })
    expect(r.paymentsDiff).toBe(-400)
  })
  it('simplifyDebts greedy matching', () => {
    expect(simplifyDebts([{ id: 'a', net: 50 }, { id: 'b', net: -20 }, { id: 'c', net: -30 }], 0)).toEqual([
      { from: 'c', to: 'a', amount: 30 },
      { from: 'b', to: 'a', amount: 20 },
    ])
    expect(simplifyDebts([{ id: 'a', net: 0.004 }, { id: 'b', net: -0.004 }], 2)).toEqual([])
    expect(simplifyDebts([{ id: 'a', net: 10.5 }, { id: 'b', net: -10.5 }], 2)).toEqual([{ from: 'b', to: 'a', amount: 10.5 }])
  })
})

describe('rounding + partial repayment', () => {
  const items = [{ id: 'i1', name: '總額', price: 1000, qty: 1, sharedBy: 'all' as const, kind: 'shared' as const }]
  it('rounds each non-payer up to 5/10, total unchanged, overcharge reported', () => {
    const r = computeSplit({ ...base, items, rounding: 10 }, 'TWD')
    expect(r.people.map((x) => x.totalRounded)).toEqual([334, 340, 340])
    expect(r.people[1].exactBeforeRounding).toBe(333)
    expect(r.grandTotalRounded).toBe(1000)
    expect(r.overcharge).toBe(14)
    expect(r.transfers.map((t) => t.due)).toEqual([340, 340])
    expect(computeSplit({ ...base, items, rounding: 5 }, 'TWD').people[1].totalRounded).toBe(335)
  })
  it('foreign project rounds the base-currency amount and settles in base currency', () => {
    const r = computeSplit({ ...base, items, currency: 'JPY', rate: 0.22, rounding: 10 }, 'TWD')
    expect(r.people[1].totalRounded).toBe(333) // JPY untouched
    expect(r.people[1].baseTotal).toBe(80) // 73 -> 80
    expect(r.transfers[0]).toMatchObject({ due: 80, dueCurrency: 'TWD', amount: 333 })
    expect(r.overchargeCurrency).toBe('TWD')
  })
  it('partial repayments reduce remaining and settle when fully paid', () => {
    const r = computeSplit({ ...base, items, partial: { b_a: 100, c_a: 333 } }, 'TWD')
    expect(r.transfers[0]).toMatchObject({ paid: 100, remaining: 233, settled: false })
    expect(r.transfers[1]).toMatchObject({ paid: 333, remaining: 0, settled: true })
    expect(r.people[2].settled).toBe(true)
  })
  it('rounding is ignored for multi-payer', () => {
    const r = computeSplit({ ...base, items, rounding: 10, payments: [{ personId: 'a', amount: 1000 }] }, 'TWD')
    expect(r.overcharge).toBe(0)
  })
})
