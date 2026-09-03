import { describe, expect, it } from 'vitest'
import { mergeData } from './sync'
import { meIdIn, personBalances, tripSettlement } from './balances'
import type { AppData, Project, Trip } from './types'

const me = { id: 'me', name: '我', emoji: '🐥', color: 'butter' }
const a = { id: 'a', name: 'A', emoji: '🐰', color: 'mint' }
const b = { id: 'b', name: 'B', emoji: '🐻', color: 'sky' }
const proj = (id: string, extra: Partial<Project>): Project => ({ id, name: id, emoji: '🍜', date: '2026-09-01', createdAt: 1, updatedAt: 1, currency: 'TWD', rate: null, mode: 'equal', payerId: 'me', people: [me, a, b], items: [{ id: 'i', name: '總額', price: 300, qty: 1, sharedBy: 'all', kind: 'shared' }], extras: [], settled: {}, ...extra })
const trip = (id: string, updatedAt: number, extra: Partial<Trip> = {}): Trip => ({ id, name: id, emoji: '🧳', createdAt: 1, updatedAt, ...extra })
const data = (extra: Partial<AppData>): AppData => ({ version: 1, me, friends: [], projects: [], baseCurrency: 'TWD', ...extra })

describe('trips merge', () => {
  it('LWW on trips, tombstones with trip: prefix, share config kept from local', () => {
    const local = data({ trips: [trip('t1', 5, { share: { id: 's', secret: 'x', role: 'member', version: 1, joinedAt: 1 } }), trip('t2', 1)], deleted: { 'trip:t3': 9 }, updatedAt: 5 })
    const remote = data({ trips: [trip('t1', 7, { name: 'renamed' }), trip('t3', 2)], updatedAt: 7 })
    const m = mergeData(local, remote, 100)
    expect(m.trips!.map((t) => t.id).sort()).toEqual(['t1', 't2'])
    expect(m.trips!.find((t) => t.id === 't1')).toMatchObject({ name: 'renamed', share: { id: 's' } })
  })
})

describe('tripSettlement', () => {
  it('nets across projects and simplifies', () => {
    // p1: me paid 300, a/b owe 100 each. p2: a paid 300, me/b owe 100 each.
    const projects = [proj('p1', {}), proj('p2', { payerId: 'a' })]
    const s = tripSettlement(projects, 'TWD')
    expect(Object.fromEntries(s.nets.map((n) => [n.person.id, n.net]))).toEqual({ me: 100, a: 100, b: -200 })
    expect(s.transfers.map((t) => `${t.from.id}>${t.to.id}:${t.amount}`).sort()).toEqual(['b>a:100', 'b>me:100'])
    expect(s.open).toHaveLength(4)
  })
})

describe('meIdIn / balances alias', () => {
  it('uses the trip alias when my own id is not in the project', () => {
    const p = proj('p1', { tripId: 't1', people: [a, b], payerId: 'a' })
    const trips = [trip('t1', 1, { share: { id: 's', secret: 'x', role: 'member', version: 1, joinedAt: 1, myPersonId: 'b' } })]
    expect(meIdIn(p, 'me', trips)).toBe('b')
    expect(meIdIn(p, 'me', [])).toBeNull()
    const bal = personBalances([p], 'me', 'TWD', trips)
    expect(bal[0].person.id).toBe('a')
    expect(bal[0].net).toBe(-150)
  })
})
