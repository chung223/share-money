import { describe, expect, it } from 'vitest'
import { buildBundle, bundleHash, decryptBundle, deriveTripKeys, encryptBundle, generateTripSecret, mergeBundle, parseTripSecret } from './tripSync'
import type { AppData, Project, Trip } from './types'

const me = { id: 'me', name: '我', emoji: '🐥', color: 'butter' }
const a = { id: 'a', name: 'A', emoji: '🐰', color: 'mint' }
const proj = (id: string, updatedAt: number, extra: Partial<Project> = {}): Project => ({ id, name: id, emoji: '🍜', date: '2026-09-01', createdAt: updatedAt, updatedAt, currency: 'TWD', rate: null, mode: 'equal', payerId: 'me', people: [me, a], items: [], extras: [], settled: {}, ...extra })
const trip = (updatedAt: number, name = 'T'): Trip => ({ id: 't1', name, emoji: '🧳', createdAt: 1, updatedAt })
const data = (extra: Partial<AppData>): AppData => ({ version: 1, me, friends: [], projects: [], baseCurrency: 'TWD', ...extra })

describe('tripSync', () => {
  it('secret round-trips, keys derive, bundle encrypts', async () => {
    const s = generateTripSecret()
    expect(parseTripSecret(`https://x/#/join/abc/${s}`)).toBe(s)
    const k = await deriveTripKeys(s)
    const d = data({ trips: [trip(5)], projects: [proj('p1', 5, { tripId: 't1', share: { id: 'x', key: 'k', expiresAt: 1, uploadedAt: 1 } }), proj('p2', 5)] })
    const b = buildBundle(d, 't1')!
    expect(b.projects.map((p) => p.id)).toEqual(['p1'])
    expect('share' in b.projects[0]).toBe(false)
    const c = await encryptBundle(k.key, b)
    expect((await decryptBundle(k.key, c)).trip.name).toBe('T')
  })
  it('mergeBundle: LWW on trip projects, tombstones, other projects untouched, trip meta by updatedAt', () => {
    const local = data({ trips: [trip(5, 'local'), { id: 't2', name: 'other', emoji: '🎉', createdAt: 1, updatedAt: 1 }], projects: [proj('p1', 5, { tripId: 't1', name: 'mine' }), proj('p3', 9, { tripId: 't2' }), proj('loose', 1)], deleted: { p9: 3 } })
    const remote = { v: 1 as const, trip: trip(7, 'remote'), projects: [proj('p1', 6, { tripId: 't1', name: 'theirs' }), proj('p2', 2, { tripId: 't1' })], deleted: { p3: 100 }, updatedAt: 7 }
    const m = mergeBundle(local, 't1', remote, 200)
    expect(m.trips!.find((t) => t.id === 't1')!.name).toBe('remote')
    expect(m.projects.find((p) => p.id === 'p1')!.name).toBe('theirs')
    expect(m.projects.some((p) => p.id === 'p2')).toBe(true)
    expect(m.projects.some((p) => p.id === 'loose')).toBe(true)
    // p3 belongs to another trip: the remote tombstone for p3 is ignored because p3 isn't in t1's scope
    expect(m.projects.some((p) => p.id === 'p3')).toBe(true)
    expect(m.deleted!.p3).toBeUndefined()
    expect(m.deleted!.p9).toBe(3)
    // hash changes only when trip content changes
    const h1 = bundleHash(buildBundle(m, 't1')!)
    const h2 = bundleHash(buildBundle({ ...m, baseCurrency: 'JPY' }, 't1')!)
    expect(h1).toBe(h2)
  })
})
