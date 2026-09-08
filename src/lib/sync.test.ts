import { describe, expect, it } from 'vitest'
import { applyShareEvents, decryptWithKey, deriveSyncKeys, encryptWithKey, generateSecret, mergeData, parseSecret } from './sync'
import { buildSnapshot, decryptNote, decryptSnapshot, encryptNote, encryptSnapshot, generateShareKey, parseShareLocation } from './share'
import type { AppData, Project } from './types'

const me = { id: 'me', name: '我', emoji: '🐥', color: 'butter' }
function proj(id: string, updatedAt: number, extra: Partial<Project> = {}): Project {
  return { id, name: id, emoji: '🍜', date: '2026-09-03', createdAt: updatedAt, updatedAt, currency: 'TWD', rate: null, mode: 'equal', payerId: 'me', people: [me], items: [], extras: [], settled: {}, ...extra }
}
function data(projects: Project[], extra: Partial<AppData> = {}): AppData {
  return { version: 1, me, friends: [], projects, baseCurrency: 'TWD', ...extra }
}

describe('secret + crypto', () => {
  it('generates parseable secrets and derives stable keys', async () => {
    const s = generateSecret()
    expect(parseSecret(s)).toBe(s)
    expect(parseSecret(`https://spilt.chung.men/#sync=${s}`)).toBe(s)
    expect(parseSecret('bb1.short')).toBeNull()
    const a = await deriveSyncKeys(s)
    const b = await deriveSyncKeys(s)
    expect(a.token).toBe(b.token)
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const c = await encryptWithKey(a.key, { hi: 1 })
    expect(await decryptWithKey(b.key, c)).toEqual({ hi: 1 })
    const other = await deriveSyncKeys(generateSecret())
    await expect(decryptWithKey(other.key, c)).rejects.toBeTruthy()
  })
  it('share snapshot round-trips and links parse', async () => {
    const key = generateShareKey()
    const snap = buildSnapshot(proj('p1', 5, { share: { id: 'x', key, expiresAt: 1, uploadedAt: 1 } }), 'TWD', '我', { bankCode: '808', account: '123' })
    expect('share' in snap.project).toBe(false)
    const c = await encryptSnapshot(key, snap)
    expect((await decryptSnapshot(key, c)).payInfo?.bankCode).toBe('808')
    expect(parseShareLocation({ pathname: '/s/abc123', hash: '#' + key })).toEqual({ id: 'abc123', key })
    expect(parseShareLocation({ pathname: '/s/abc123', hash: '' })).toBeNull()
    const n = await encryptNote(key, '末五碼 12345')
    expect(await decryptNote(key, n)).toBe('末五碼 12345')
    expect(await decryptNote(generateShareKey(), n)).toBeNull()
  })
})

describe('mergeData', () => {
  it('unions projects and takes the newer copy of each', () => {
    const local = data([proj('a', 10), proj('b', 5)], { updatedAt: 10 })
    const remote = data([proj('b', 7, { name: 'b-remote' }), proj('c', 3)], { updatedAt: 7 })
    const m = mergeData(local, remote, 100)
    expect(m.projects.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(m.projects.find((p) => p.id === 'b')!.name).toBe('b-remote')
  })
  it('deletions win over stale copies but lose to later edits', () => {
    const local = data([], { deleted: { a: 20, b: 5 }, updatedAt: 20 })
    const remote = data([proj('a', 10), proj('b', 9)], { updatedAt: 10 })
    const m = mergeData(local, remote, 100)
    expect(m.projects.map((p) => p.id)).toEqual(['b'])
    expect(m.deleted).toEqual({ a: 20 })
  })
  it('scalar fields follow the newer blob, friends union, sync config stays local', () => {
    const local = data([], { updatedAt: 1, baseCurrency: 'TWD', friends: [{ ...me, id: 'f1' }], sync: { secret: 'L', serverUrl: '', enabledAt: 1 } })
    const remote = data([], { updatedAt: 2, baseCurrency: 'JPY', friends: [{ ...me, id: 'f2' }], payInfo: { bankCode: '812' }, sync: { secret: 'R', serverUrl: '', enabledAt: 1 } })
    const m = mergeData(local, remote, 100)
    expect(m.baseCurrency).toBe('JPY')
    expect(m.payInfo?.bankCode).toBe('812')
    expect(m.friends.map((f) => f.id).sort()).toEqual(['f1', 'f2'])
    expect(m.sync?.secret).toBe('L')
    expect(m.updatedAt).toBe(2)
  })
  it('is idempotent', () => {
    const local = data([proj('a', 10)], { updatedAt: 10 })
    const once = mergeData(local, local, 100)
    expect(mergeData(once, once, 100)).toEqual(once)
  })
})

describe('applyShareEvents', () => {
  it('marks settled and bumps updatedAt, ignores unknown people', () => {
    const d = data([proj('a', 10, { people: [me, { ...me, id: 'x' }] })])
    const ids = applyShareEvents(d, [
      { id: 1, shareId: 's', projectId: 'a', personId: 'x', kind: 'paid', createdAt: 50 },
      { id: 2, shareId: 's', projectId: 'a', personId: 'ghost', kind: 'paid', createdAt: 60 },
      { id: 3, shareId: 's', projectId: 'nope', personId: 'x', kind: 'paid', createdAt: 60 },
    ])
    expect(ids).toEqual([1, 2, 3])
    expect(d.projects[0].settled).toEqual({ x: true })
    expect(d.projects[0].updatedAt).toBe(50)
  })
  it('accepts transfer keys (multi-payer) and rejects keys with unknown people', () => {
    const d = data([proj('a', 10, { people: [me, { ...me, id: 'x' }] })])
    applyShareEvents(d, [
      { id: 1, shareId: 's', projectId: 'a', personId: 'x_me', kind: 'paid', createdAt: 50 },
      { id: 2, shareId: 's', projectId: 'a', personId: 'x_zz', kind: 'paid', createdAt: 50 },
    ])
    expect(d.projects[0].settled).toEqual({ x_me: true })
  })
  it('keeps decrypted notes per transfer and drops them on unpaid', () => {
    const d = data([proj('a', 10, { people: [me, { ...me, id: 'x' }] })])
    applyShareEvents(d, [{ id: 1, shareId: 's', projectId: 'a', personId: 'x', kind: 'paid', createdAt: 50, noteText: 'LINE Pay 末五碼 12345' }])
    expect(d.projects[0].paidNotes).toEqual({ x: 'LINE Pay 末五碼 12345' })
    applyShareEvents(d, [{ id: 2, shareId: 's', projectId: 'a', personId: 'x', kind: 'unpaid', createdAt: 60 }])
    expect(d.projects[0].paidNotes).toEqual({})
  })
})
