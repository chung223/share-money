import { describe, expect, it } from 'vitest'
import { buildPersonSnapshot, isPersonSnapshot, projectsForPerson } from './share'
import { computeSplit } from './split'
import type { Project } from './types'

const me = { id: 'me', name: '我', emoji: '🐥', color: 'butter' }
const ming = { id: 'ming', name: '小明', emoji: '🐰', color: 'mint' }
const proj = (id: string, extra: Partial<Project> = {}): Project => ({ id, name: id, emoji: '🍜', date: '2026-09-03', createdAt: 1, updatedAt: Date.now(), currency: 'TWD', rate: null, mode: 'equal', payerId: 'me', people: [me, ming], items: [{ id: 'i', name: '總額', price: 600, qty: 1, sharedBy: 'all', kind: 'shared' }], extras: [], settled: {}, ...extra })

describe('person share', () => {
  it('picks projects with open (or recently settled) transfers between me and the person', () => {
    const projects = [proj('open'), proj('settled-old', { settled: { ming: true }, updatedAt: 1 }), proj('settled-recent', { settled: { ming: true } }), proj('other', { people: [me] })]
    const picked = projectsForPerson(projects, 'ming', () => 'me', 'TWD', (p) => computeSplit(p, 'TWD').transfers)
    expect(picked.map((p) => p.id).sort()).toEqual(['open', 'settled-recent'])
    const snap = buildPersonSnapshot({ person: ming, projects: picked, ownerId: 'me', ownerName: '我', baseCurrency: 'TWD' })
    expect(isPersonSnapshot(snap)).toBe(true)
    expect(snap.projects.every((p) => !('share' in p))).toBe(true)
  })
})
