import { describe, expect, it } from 'vitest'
import { applyLineCommands, buildMirror } from './lineMirror'
import { newPerson } from '../store'
import type { AppData, Project } from './types'

const me = { id: 'me', name: '阿賴', emoji: '🐥', color: 'butter' }
const ming = { id: 'ming', name: '小明', emoji: '🐰', color: 'mint' }
const proj = (id: string, extra: Partial<Project> = {}): Project => ({ id, name: id, emoji: '🍜', date: '2026-09-03', createdAt: 1, updatedAt: 1, currency: 'TWD', rate: null, mode: 'equal', payerId: 'me', people: [me, ming], items: [{ id: 'i', name: '總額', price: 600, qty: 1, sharedBy: 'all', kind: 'shared' }], extras: [], settled: {}, ...extra })
const data = (): AppData => ({ version: 1, me, friends: [ming], projects: [proj('拉麵聚'), proj('計程車', { date: '2026-09-04' })], baseCurrency: 'TWD', payInfo: { bankCode: '808', account: '123' } })

describe('buildMirror', () => {
  it('mirrors settlement results only', () => {
    const m = buildMirror(data())
    expect(m.projects.map((p) => p.id)).toEqual(['計程車', '拉麵聚'])
    expect(m.projects[1].transfers[0]).toMatchObject({ from: 'ming', to: 'me', amount: 300, remaining: 300, settled: false })
    expect(m.payLines).toEqual(['808 123'])
    expect(JSON.stringify(m)).not.toContain('總額') // no items
  })
})

describe('applyLineCommands', () => {
  it('settles all, settles partial on the given project, adds a person, deletes with tombstone', () => {
    const d = data()
    const r = applyLineCommands(
      d,
      [
        { id: 1, createdAt: 1, type: 'settle', personId: 'ming', personName: '小明', amount: 100, projectId: '計程車' },
        { id: 2, createdAt: 1, type: 'addPerson', projectId: '拉麵聚', personName: '阿花' },
        { id: 3, createdAt: 1, type: 'deleteProject', projectId: '拉麵聚' },
      ],
      newPerson,
    )
    expect(r.applied).toBe(3)
    expect(d.projects.find((p) => p.id === '計程車')!.partial).toEqual({ ming_me: 100 })
    expect(d.friends.map((f) => f.name)).toContain('阿花')
    expect(d.projects.some((p) => p.id === '拉麵聚')).toBe(false)
    expect(d.deleted!['拉麵聚']).toBeTruthy()
    const r2 = applyLineCommands(d, [{ id: 4, createdAt: 1, type: 'settle', personId: 'ming', personName: '小明' }], newPerson)
    expect(r2.applied).toBe(1)
    expect(d.projects.find((p) => p.id === '計程車')!.settled.ming_me).toBe(true)
  })
})
