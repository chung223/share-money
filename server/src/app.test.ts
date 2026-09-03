import { describe, expect, it } from 'vitest'
import { openDb } from './db.ts'
import { createApp } from './app.ts'

const T0 = 1_700_000_000_000
function setup(t0 = T0) {
  let t = t0
  const db = openDb(':memory:')
  const { app, purgeExpired, purgeInactive } = createApp({ db, now: () => t, adminToken: 'admin-secret', inactiveDays: 30 })
  const call = (path: string, init: RequestInit = {}, token?: string, ip = '1.2.3.4') =>
    app.request(path, { ...init, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } })
  return { call, tick: (ms: number) => (t += ms), purgeExpired, purgeInactive }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function body(r: Response | Promise<Response>): Promise<any> {
  return (await r).json()
}
const A = 'a'.repeat(43)
const B = 'b'.repeat(43)
const json = (o: unknown) => ({ method: 'PUT', body: JSON.stringify(o) })
const post = (o: unknown) => ({ method: 'POST', body: JSON.stringify(o) })

describe('sync', () => {
  it('rejects missing/short tokens', async () => {
    const { call } = setup()
    expect((await call('/api/sync')).status).toBe(401)
    expect((await call('/api/sync', {}, 'short')).status).toBe(401)
  })
  it('starts empty, then versions with optimistic locking', async () => {
    const { call } = setup()
    let r = await call('/api/sync', {}, A)
    expect(await r.json()).toMatchObject({ version: 0, cipher: null, events: [] })
    r = await call('/api/sync', json({ baseVersion: 0, cipher: 'c1' }), A)
    expect(r.status).toBe(200)
    expect((await body(r)).version).toBe(1)
    // stale base -> 409 with server copy
    r = await call('/api/sync', json({ baseVersion: 0, cipher: 'c2' }), A)
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ version: 1, cipher: 'c1' })
    r = await call('/api/sync', json({ baseVersion: 1, cipher: 'c2' }), A)
    expect((await body(r)).version).toBe(2)
    // other account sees nothing
    r = await call('/api/sync', {}, B)
    expect((await body(r)).version).toBe(0)
  })
  it('delete wipes the account', async () => {
    const { call } = setup()
    await call('/api/sync', json({ baseVersion: 0, cipher: 'c1' }), A)
    expect((await call('/api/sync', { method: 'DELETE' }, A)).status).toBe(200)
    expect((await body(call('/api/sync', {}, A))).version).toBe(0)
  })
})

describe('share', () => {
  it('creates, reads publicly, records paid, feeds events into sync, acks', async () => {
    const { call, tick } = setup()
    let r = await call('/api/share', post({ projectId: 'p1', cipher: 'enc', expiresAt: T0 + 86_400_000 }), A)
    expect(r.status).toBe(200)
    const { id } = await body(r)
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/)
    // re-share same project keeps the id
    r = await call('/api/share', post({ projectId: 'p1', cipher: 'enc2', expiresAt: T0 + 86_400_000 }), A)
    expect((await body(r)).id).toBe(id)
    // public read, no auth
    r = await call(`/api/share/${id}`)
    expect(await r.json()).toMatchObject({ cipher: 'enc2', paid: [] })
    // friend taps paid
    r = await call(`/api/share/${id}/paid`, post({ personId: 'x1' }))
    expect(r.status).toBe(200)
    expect((await body(call(`/api/share/${id}`))).paid).toEqual(['x1'])
    // undo
    await call(`/api/share/${id}/paid`, post({ personId: 'x1', kind: 'unpaid' }))
    expect((await body(call(`/api/share/${id}`))).paid).toEqual([])
    // owner sees both events in sync until acked
    let s = await body(call('/api/sync', {}, A))
    expect(s.events.map((e: { kind: string }) => e.kind)).toEqual(['paid', 'unpaid'])
    expect(s.shares[0]).toMatchObject({ id, projectId: 'p1' })
    await call('/api/share/ack', post({ ids: s.events.map((e: { id: number }) => e.id) }), A)
    s = await body(call('/api/sync', {}, A))
    expect(s.events).toEqual([])
    // other account cannot ack/delete
    expect((await call(`/api/share/${id}`, { method: 'DELETE' }, B)).status).toBe(200)
    expect((await call(`/api/share/${id}`)).status).toBe(200)
    // expiry
    tick(2 * 86_400_000)
    expect((await call(`/api/share/${id}`)).status).toBe(410)
    expect((await call(`/api/share/${id}/paid`, post({ personId: 'x1' }))).status).toBe(410)
    expect((await call(`/api/share/${id}`, { method: 'DELETE' }, A)).status).toBe(200)
    expect((await call(`/api/share/${id}`)).status).toBe(404)
  })
  it('validates input', async () => {
    const { call } = setup()
    expect((await call('/api/share', post({ projectId: 'p1', cipher: 'x', expiresAt: 1 }), A)).status).toBe(400)
    expect((await call('/api/share', post({ projectId: 'bad id!', cipher: 'x', expiresAt: T0 + 1000 }), A)).status).toBe(400)
    expect((await call('/api/share', post({ projectId: 'p1', cipher: 'x'.repeat(300_000), expiresAt: T0 + 1000 }), A)).status).toBe(413)
    expect((await call('/api/share/nope')).status).toBe(404)
    expect((await call('/api/share/nope/paid', post({ personId: 'x' }))).status).toBe(404)
    expect((await call('/api/share', post({}))).status).toBe(401)
  })
})

describe('multi-user hardening', () => {
  it('limits new accounts per IP but not returning ones', async () => {
    const { call } = setup()
    for (let i = 0; i < 10; i++) expect((await call('/api/sync', {}, String(i).repeat(43))).status).toBe(200)
    expect((await call('/api/sync', {}, 'z'.repeat(43))).status).toBe(429)
    expect((await call('/api/sync', {}, '0'.repeat(43))).status).toBe(200) // existing account still fine
    expect((await call('/api/sync', {}, 'z'.repeat(43), '9.9.9.9')).status).toBe(200) // other IP
  })
  it('purges inactive accounts with their blobs and shares', async () => {
    const { call, tick, purgeInactive } = setup()
    await call('/api/sync', json({ baseVersion: 0, cipher: 'c' }), A)
    const { id } = await body(call('/api/share', post({ projectId: 'p', cipher: 'x', expiresAt: T0 + 100 * 86_400_000 }), A))
    tick(10 * 86_400_000)
    await call('/api/sync', {}, B) // B stays fresh
    tick(25 * 86_400_000)
    expect(purgeInactive()).toBe(1)
    expect((await call(`/api/share/${id}`)).status).toBe(404)
    expect((await body(call('/api/sync', {}, A))).version).toBe(0) // recreated empty
    expect((await body(call('/api/sync', {}, B))).version).toBe(0)
  })
  it('admin stats need the admin token', async () => {
    const { call } = setup()
    await call('/api/sync', json({ baseVersion: 0, cipher: 'abc' }), A)
    expect((await call('/api/admin/stats')).status).toBe(401)
    expect((await call('/api/admin/stats', {}, 'nope')).status).toBe(401)
    const s = await body(call('/api/admin/stats', {}, 'admin-secret'))
    expect(s).toMatchObject({ accounts: 1, active_7d: 1, blobs: 1, blob_bytes: 3, shares: 0 })
  })
})
