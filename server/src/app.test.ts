import { describe, expect, it } from 'vitest'
import { openDb } from './db.ts'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from './app.ts'
import { normalise } from './ai.ts'
import { createLineClient } from './line.ts'
import { createHmac } from 'node:crypto'
import sharp from 'sharp'
const sharpPng: Buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#fff7f0' } }).png().toBuffer()

const T0 = 1_700_000_000_000
function setup(t0 = T0) {
  let t = t0
  const db = openDb(':memory:')
  const sent: { endpoint: string; payload: string }[] = []
  const dead = new Set<string>()
  const push = {
    publicKey: 'PUB',
    async send(sub: { endpoint: string }, payload: string) {
      sent.push({ endpoint: sub.endpoint, payload })
      return !dead.has(sub.endpoint)
    },
  }
  const shareHtml = join(tmpdir(), `banban-share-${process.pid}.html`)
  writeFileSync(shareHtml, '<!doctype html><html><head><meta charset="utf-8"><title>x</title></head><body><div id="root"></div></body></html>')
  const aiCalls: unknown[] = []
  const byokCalls: { url: string; auth?: string }[] = []
  const lineOut: { url: string; body: unknown }[] = []
  const line = createLineClient({
    channelSecret: 'secret',
    accessToken: 'tok',
    fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      lineOut.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (u.includes('/profile/')) return new Response(JSON.stringify({ displayName: '小賴' }), { status: 200 })
      if (u.includes('/content')) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch,
  })
  const { app, purgeExpired, purgeInactive, runWeekly } = createApp({
    db, now: () => t, adminToken: 'admin-secret', inactiveDays: 30, push, publicOrigin: 'https://example.test', shareHtml,
    renderOgImage: async (i) => Buffer.from('PNG:' + i.title),
    ai: { enabled: true, parse: async (input) => { aiCalls.push(input); return { items: [{ name: '牛肉麵', qty: 1, price: 180 }], extras: [], total: 180, date: null, currency: 'TWD', merchant: null } }, chat: async (input) => { aiCalls.push(input); return 'echo:' + input.user } },
    aiDailyQuota: 2,
    aiGlobalDaily: 3,
    aiInviteCode: 'friends-only',
    line,
    imageGen: { enabled: true, generate: async () => sharpPng },
    memeDir: join(tmpdir(), `banban-memes-${process.pid}`),
    byokFetch: (async (url: string | URL | Request, init?: RequestInit) => {
      byokCalls.push({ url: String(url), auth: (init?.headers as Record<string, string>)?.authorization ?? (init?.headers as Record<string, string>)?.['x-api-key'] })
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"name":"byok","qty":1,"price":9}]}' } }] }), { status: 200 })
    }) as unknown as typeof fetch,
  })
  const call = (path: string, init: RequestInit = {}, token?: string, ip = '1.2.3.4') =>
    app.request(path, { ...init, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } })
  return { call, tick: (ms: number) => (t += ms), setTime: (ms: number) => (t = ms), purgeExpired, purgeInactive, runWeekly, sent, dead, aiCalls, byokCalls, lineOut }
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

describe('notes + push', () => {
  it('stores note/label on paid events and pushes to the owner', async () => {
    const { call, sent, dead } = setup()
    const { id } = await body(call('/api/share', post({ projectId: 'p1', cipher: 'enc', expiresAt: T0 + 86_400_000 }), A))
    expect((await body(call('/api/push/vapid'))).publicKey).toBe('PUB')
    expect((await call('/api/push/subscribe', post({ endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } }), A)).status).toBe(200)
    expect((await call('/api/push/subscribe', post({ endpoint: 'nope', keys: { p256dh: 'k', auth: 'a' } }), A)).status).toBe(400)
    expect((await body(call('/api/sync', {}, A))).push).toEqual({ enabled: true })
    await call(`/api/share/${id}/paid`, post({ personId: 'x1', note: 'ENC(末五碼 12345)', label: '小明' }))
    await new Promise((r) => setTimeout(r, 5))
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0].payload).body).toContain('小明')
    const s = await body(call('/api/sync', {}, A))
    expect(s.events[0]).toMatchObject({ note: 'ENC(末五碼 12345)', label: '小明' })
    // test push, then a dead endpoint gets dropped
    expect((await body(call('/api/push/test', post({}), A))).sent).toBe(1)
    dead.add('https://push.example/abc')
    await call(`/api/share/${id}/paid`, post({ personId: 'x1' }))
    await new Promise((r) => setTimeout(r, 5))
    expect((await body(call('/api/sync', {}, A))).push).toEqual({ enabled: false })
    expect((await call('/api/push/test', post({}), A)).status).toBe(400)
    // unsubscribe path
    await call('/api/push/subscribe', post({ endpoint: 'https://push.example/xyz', keys: { p256dh: 'k', auth: 'a' } }), A)
    await call('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: 'https://push.example/xyz' }) }, A)
    expect((await body(call('/api/sync', {}, A))).push).toEqual({ enabled: false })
  })
})

describe('open graph', () => {
  it('injects escaped og tags into the share html and serves a preview image', async () => {
    const { call, tick } = setup()
    const { id } = await body(call('/api/share', post({ projectId: 'p1', cipher: 'enc', expiresAt: T0 + 86_400_000, ogTitle: '拉麵聚 <b>4 人</b>' }), A))
    let html = await (await call(`/s/${id}`)).text()
    expect(html).toContain('og:title" content="拉麵聚 &lt;b&gt;4 人&lt;/b&gt;"')
    expect(html).toContain(`og:image" content="https://example.test/api/share/${id}/og.png?v=`)
    expect(html).not.toContain('<title>x</title>')
    expect(html).toContain('<div id="root"></div>')
    const png = await call(`/api/share/${id}/og.png`)
    expect(png.headers.get('content-type')).toBe('image/png')
    expect(await png.text()).toBe('PNG:拉麵聚 <b>4 人</b>')
    // hide the title: null clears it; omitted keeps it
    await call('/api/share', post({ projectId: 'p1', cipher: 'enc', expiresAt: T0 + 86_400_000 }), A)
    expect(await (await call(`/s/${id}`)).text()).toContain('拉麵聚')
    await call('/api/share', post({ projectId: 'p1', cipher: 'enc', expiresAt: T0 + 86_400_000, ogTitle: null }), A)
    html = await (await call(`/s/${id}`)).text()
    expect(html).toContain('og:title" content="有人幫你先付了 💸"')
    // unknown / expired still render the page (the app shows the error state) with a neutral title
    expect(await (await call('/s/nope')).text()).toContain('找不到這個分帳')
    tick(3 * 86_400_000)
    expect(await (await call(`/s/${id}`)).text()).toContain('分帳連結過期了')
    expect(await (await call(`/api/share/${id}/og.png`)).text()).toBe('PNG:這個分帳連結過期了')
  })
})

describe('ai parse', () => {
  it('needs an invite code (or admin allow), then enforces per-account and global quotas', async () => {
    const { call, tick, aiCalls } = setup()
    expect((await call('/api/parse', post({ text: 'x' }))).status).toBe(401)
    // not allowed yet
    let r = await call('/api/parse', post({ text: '牛肉麵 180' }), A)
    expect(r.status).toBe(403)
    expect((await body(call('/api/ai/status', {}, A)))).toMatchObject({ available: true, allowed: false, needsCode: true, quota: 2 })
    expect((await call('/api/ai/redeem', post({ code: 'wrong' }), A)).status).toBe(403)
    expect((await body(call('/api/ai/redeem', post({ code: 'friends-only' }), A))).allowed).toBe(true)
    expect((await call('/api/parse', post({}), A)).status).toBe(400)
    expect((await call('/api/parse', post({ image: { mediaType: 'text/html', base64: 'x' } }), A)).status).toBe(400)
    let j = await body(call('/api/parse', post({ text: '牛肉麵 180' }), A))
    expect(j.items[0].name).toBe('牛肉麵')
    expect(j.remaining).toBe(1)
    await call('/api/parse', post({ image: { mediaType: 'image/jpeg', base64: 'AAAA' } }), A)
    expect(aiCalls).toHaveLength(2)
    expect((await call('/api/parse', post({ text: 'x' }), A)).status).toBe(429) // per-account
    // admin allows B directly; global cap (3) then bites after one more call
    const list = await body(call('/api/admin/ai', {}, 'admin-secret'))
    expect(list.accounts).toHaveLength(1)
    expect(list.globalUsed).toBe(2)
    const bId = (await body(call('/api/ai/status', {}, B))).accountId
    expect((await call('/api/admin/ai', post({ accountId: bId, allow: true, note: '朋友' }), 'admin-secret')).status).toBe(200)
    expect((await call('/api/parse', post({ text: 'x' }), B)).status).toBe(200)
    expect((await call('/api/parse', post({ text: 'x' }), B)).status).toBe(429) // global
    expect((await call('/api/admin/ai', post({ accountId: bId, allow: false }), 'admin-secret')).status).toBe(200)
    tick(86_400_000)
    expect((await call('/api/parse', post({ text: 'x' }), B)).status).toBe(403) // revoked
    expect((await call('/api/parse', post({ text: 'x' }), A)).status).toBe(200) // new day
    expect((await body(call('/api/health'))).ai).toBe(true)
    expect((await call('/api/admin/ai')).status).toBe(401)
  })
  it('normalises sloppy model output', () => {
    const out = normalise('好的，這是結果：{"items":[{"name":"1. 珍奶","qty":"2","price":"65"},{"name":"","price":10},{"name":"x","price":0}],"extras":[{"name":"折扣","amount":-20}],"total":"150","date":"2026/09/03","currency":"twd"}')
    expect(out.items).toEqual([{ name: '1. 珍奶', qty: 2, price: 65 }])
    expect(out.extras).toEqual([{ name: '折扣', amount: -20 }])
    expect(out.total).toBe(150)
    expect(out.date).toBeNull()
    expect(out.currency).toBeNull()
    expect(() => normalise('nothing')).toThrow()
    expect(normalise('<think>想一下</think>```json\n{"items":[{"name":"a","qty":1,"price":5}]}\n```').items).toHaveLength(1)
    // trailing prose / second object after the JSON must not break parsing
    expect(normalise('{"items":[{"name":"a \\"b\\"","qty":1,"price":5}],"total":5} 以上是結果 {"x":1}').total).toBe(5)
  })
})

describe('byok proxy', () => {
  it('forwards to a public https provider with the caller key, rejects private/http urls', async () => {
    const { call, byokCalls } = setup()
    const provider = { format: 'openai', baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'sk-user' }
    expect((await call('/api/parse/byok', post({ provider, text: 'x' }))).status).toBe(401)
    const r = await body(call('/api/parse/byok', post({ provider, text: 'x' }), A))
    expect(r.items[0].name).toBe('byok')
    expect(byokCalls[0]).toEqual({ url: 'https://api.example.com/v1/chat/completions', auth: 'Bearer sk-user' })
    expect((await call('/api/parse/byok', post({ provider: { ...provider, baseUrl: 'http://api.example.com/v1' }, text: 'x' }), A)).status).toBe(400)
    expect((await call('/api/parse/byok', post({ provider: { ...provider, baseUrl: 'https://127.0.0.1:3456/v1' }, text: 'x' }), A)).status).toBe(400)
    expect((await call('/api/parse/byok', post({ provider: { ...provider, apiKey: '' }, text: 'x' }), A)).status).toBe(400)
    // anthropic format goes to /messages with x-api-key
    await call('/api/parse/byok', post({ provider: { ...provider, format: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }, text: 'x' }), A)
    expect(byokCalls[1]).toEqual({ url: 'https://api.anthropic.com/v1/messages', auth: 'sk-user' })
  })
})

describe('ai chat', () => {
  it('site chat is gated and counts against the quota; byok chat proxies', async () => {
    const { call, byokCalls } = setup()
    expect((await call('/api/ai/chat', post({ system: 's', user: 'u' }), A)).status).toBe(403)
    await call('/api/ai/redeem', post({ code: 'friends-only' }), A)
    expect((await call('/api/ai/chat', post({ system: 's' }), A)).status).toBe(400)
    const r = await body(call('/api/ai/chat', post({ system: 's', user: 'hi' }), A))
    expect(r).toMatchObject({ text: 'echo:hi', remaining: 1 })
    const provider = { format: 'openai', baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'sk-user' }
    const b = await body(call('/api/ai/byok', post({ provider, system: 's', user: 'u' }), A))
    expect(typeof b.text).toBe('string')
    expect(byokCalls.at(-1)?.url).toBe('https://api.example.com/v1/chat/completions')
  })
})

describe('shared trips', () => {
  it('create, read, optimistic-lock write, wrong token rejected, delete', async () => {
    const { call } = setup()
    const T = 't'.repeat(43)
    expect((await call('/api/trip', { method: 'POST' })).status).toBe(401)
    const { id } = await body(call('/api/trip', { method: 'POST' }, T))
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/)
    expect(await body(call(`/api/trip/${id}`, {}, T))).toMatchObject({ version: 0, cipher: null })
    expect((await call(`/api/trip/${id}`, {}, 'x'.repeat(43))).status).toBe(404)
    let r = await call(`/api/trip/${id}`, json({ baseVersion: 0, cipher: 'c1' }), T)
    expect((await body(r)).version).toBe(1)
    r = await call(`/api/trip/${id}`, json({ baseVersion: 0, cipher: 'c2' }), T)
    expect(r.status).toBe(409)
    expect((await body(r)).cipher).toBe('c1')
    expect((await call(`/api/trip/${id}`, json({ baseVersion: 1, cipher: 'c2' }), T)).status).toBe(200)
    expect((await call(`/api/trip/${id}`, { method: 'DELETE' }, 'x'.repeat(43))).status).toBe(404)
    expect((await call(`/api/trip/${id}`, { method: 'DELETE' }, T)).status).toBe(200)
    expect((await call(`/api/trip/${id}`, {}, T)).status).toBe(404)
  })
})

describe('LINE bot', () => {
  const sig = (body: string) => createHmac('sha256', 'secret').update(body).digest('base64')
  const hook = (call: ReturnType<typeof setup>['call'], events: unknown[]) => {
    const body = JSON.stringify({ destination: 'x', events })
    return call('/api/line/webhook', { method: 'POST', body, headers: { 'x-line-signature': sig(body) } })
  }
  it('rejects bad signatures', async () => {
    const { call } = setup()
    expect((await call('/api/line/webhook', { method: 'POST', body: '{"events":[]}', headers: { 'x-line-signature': 'nope' } })).status).toBe(401)
    expect((await hook(call, [])).status).toBe(200)
  })
  it('link code flow, text/image drafts show up in sync, ack clears them, push on paid', async () => {
    const { call, lineOut, tick } = setup()
    expect((await body(call('/api/line/status', {}, A)))).toMatchObject({ available: true, linked: false, pending: 0 })
    const { code } = await body(call('/api/line/link-code', post({}), A))
    expect(code).toMatch(/^[A-Z2-9]{6}$/)
    // unlinked user gets help
    await hook(call, [{ type: 'message', replyToken: 'r1', source: { type: 'user', userId: 'U1' }, message: { type: 'text', id: '1', text: '嗨' } }])
    await new Promise((r) => setTimeout(r, 10))
    expect(JSON.stringify(lineOut.at(-1)?.body)).toContain('連結碼')
    // wrong then right code
    await hook(call, [{ type: 'message', replyToken: 'r2', source: { type: 'user', userId: 'U1' }, message: { type: 'text', id: '2', text: '連結 ZZZZZZ' } }])
    await hook(call, [{ type: 'message', replyToken: 'r3', source: { type: 'user', userId: 'U1' }, message: { type: 'text', id: '3', text: `連結 ${code.toLowerCase()}` } }])
    await new Promise((r) => setTimeout(r, 20))
    expect((await body(call('/api/line/status', {}, A)))).toMatchObject({ linked: true, displayName: '小賴' })
    // text draft + image draft (site AI allowed -> receipt)
    await call('/api/ai/redeem', post({ code: 'friends-only' }), A)
    await hook(call, [
      { type: 'message', replyToken: 'r4', source: { type: 'user', userId: 'U1' }, message: { type: 'text', id: '4', text: '昨天拉麵 900 我付的' } },
      { type: 'message', replyToken: 'r5', source: { type: 'user', userId: 'U1' }, message: { type: 'image', id: '5' } },
    ])
    await new Promise((r) => setTimeout(r, 30))
    const s = await body(call('/api/sync', {}, A))
    expect(s.lineDrafts.map((d: { kind: string }) => d.kind)).toEqual(['text', 'receipt'])
    expect(s.lineDrafts[0].payload.text).toBe('昨天拉麵 900 我付的')
    expect(s.lineDrafts[1].payload.receipt.items[0].name).toBe('牛肉麵')
    await call('/api/line/ack', post({ ids: s.lineDrafts.map((d: { id: number }) => d.id) }), A)
    expect((await body(call('/api/sync', {}, A))).lineDrafts).toEqual([])
    // paid event pushes to LINE when linked
    const { id } = await body(call('/api/share', post({ projectId: 'p1', cipher: 'enc', expiresAt: T0 + 86_400_000 }), A))
    await call(`/api/share/${id}/paid`, post({ personId: 'x1', label: '小明' }))
    await new Promise((r) => setTimeout(r, 10))
    expect(lineOut.some((o) => o.url.endsWith('/message/push') && JSON.stringify(o.body).includes('小明'))).toBe(true)
    // disable push, unlink
    await call('/api/line/push', post({ enabled: false }), A)
    await call('/api/line/link', { method: 'DELETE' }, A)
    expect((await body(call('/api/line/status', {}, A))).linked).toBe(false)
    tick(1)
  })
})

describe('LINE bot interactions', () => {
  const sig = (body: string) => createHmac('sha256', 'secret').update(body).digest('base64')
  const hook = (call: ReturnType<typeof setup>['call'], events: unknown[]) => {
    const body = JSON.stringify({ destination: 'x', events })
    return call('/api/line/webhook', { method: 'POST', body, headers: { 'x-line-signature': sig(body) } })
  }
  const link = async (call: ReturnType<typeof setup>['call'], userId: string, token: string) => {
    const { code } = await body(call('/api/line/link-code', post({}), token))
    await hook(call, [{ type: 'message', replyToken: 'r', source: { type: 'user', userId }, message: { type: 'text', id: 'x', text: `連結 ${code}` } }])
    await new Promise((r) => setTimeout(r, 20))
  }
  it('receipt flex + postback ack, inbox postback, group mentions, summary + weekly push', async () => {
    const { call, lineOut, runWeekly, setTime } = setup()
    await link(call, 'U1', A)
    await call('/api/ai/redeem', post({ code: 'friends-only' }), A)
    // image -> flex with ack button
    await hook(call, [{ type: 'message', replyToken: 'r1', source: { type: 'user', userId: 'U1' }, message: { type: 'image', id: '9' } }])
    await new Promise((r) => setTimeout(r, 30))
    const flex = lineOut.at(-1)!.body as { messages: { type: string; contents?: unknown }[] }
    expect(flex.messages[0].type).toBe('flex')
    expect(JSON.stringify(flex.messages[0].contents)).toContain('ack:')
    const id = Number(/ack:(\d+)/.exec(JSON.stringify(flex.messages[0].contents))![1])
    // postback inbox lists it; ack clears it
    await hook(call, [{ type: 'postback', replyToken: 'r2', source: { type: 'user', userId: 'U1' }, postback: { data: 'inbox' } }])
    await new Promise((r) => setTimeout(r, 20))
    expect(JSON.stringify(lineOut.at(-1)!.body)).toContain('收件匣 1 筆')
    await hook(call, [{ type: 'postback', replyToken: 'r3', source: { type: 'user', userId: 'U1' }, postback: { data: `ack:${id}` } }])
    await new Promise((r) => setTimeout(r, 20))
    expect((await body(call('/api/sync', {}, A))).lineDrafts).toEqual([])
    // group: ignored unless mentioned / prefixed
    await hook(call, [{ type: 'message', replyToken: 'r4', source: { type: 'group', userId: 'U1', groupId: 'G1' }, message: { type: 'text', id: '1', text: '大家午餐吃什麼' } }])
    await hook(call, [{ type: 'message', replyToken: 'r5', source: { type: 'group', userId: 'U1', groupId: 'G1' }, message: { type: 'text', id: '2', text: '반반 拉麵 900 我付' } }])
    await hook(call, [{ type: 'message', replyToken: 'r6', source: { type: 'group', userId: 'U2', groupId: 'G1' }, message: { type: 'text', id: '3', text: '@반반 計程車 300', mention: { mentionees: [{ isSelf: true, index: 0, length: 3 }] } } }])
    await new Promise((r) => setTimeout(r, 40))
    const drafts = (await body(call('/api/sync', {}, A))).lineDrafts
    expect(drafts.map((d: { payload: { text: string } }) => d.payload.text)).toEqual(['拉麵 900 我付'])
    expect(JSON.stringify(lineOut.at(-1)!.body)).toContain('還沒綁帳號') // U2 not linked
    // summary: disabled -> 400; enable -> upload -> balances postback shows it
    expect((await call('/api/line/summary', post({ items: [{ name: '小明', amount: 250 }] }), A)).status).toBe(400)
    await call('/api/line/settings', post({ summaryEnabled: true, weeklyEnabled: true }), A)
    expect((await body(call('/api/line/summary', post({ items: [{ name: '小明', amount: 250, projects: ['拉麵'] }, { name: '小華', amount: 0 }], currency: 'TWD' }), A))).items).toBe(1)
    await hook(call, [{ type: 'postback', replyToken: 'r7', source: { type: 'user', userId: 'U1' }, postback: { data: 'balances' } }])
    await new Promise((r) => setTimeout(r, 20))
    expect(JSON.stringify(lineOut.at(-1)!.body)).toContain('小明')
    // weekly: only Monday 09:00 Taipei
    setTime(Date.UTC(2026, 8, 7, 1, 30)) // 2026-09-07 is Monday, 09:30 Taipei
    expect(await runWeekly()).toBe(1)
    expect(JSON.stringify(lineOut.at(-1)!.body)).toContain('週一提醒')
    expect(await runWeekly()).toBe(0) // already sent this week
    setTime(Date.UTC(2026, 8, 8, 1, 30)) // Tuesday
    expect(await runWeekly()).toBe(0)
    // turning summary off deletes the stored summary
    await call('/api/line/settings', post({ summaryEnabled: false }), A)
    await hook(call, [{ type: 'postback', replyToken: 'r8', source: { type: 'user', userId: 'U1' }, postback: { data: 'balances' } }])
    await new Promise((r) => setTimeout(r, 20))
    expect(JSON.stringify(lineOut.at(-1)!.body)).toContain('催款摘要同步')
  })
})

describe('meme', () => {
  it('needs AI permission and enough quota', async () => {
    const { call } = setup()
    expect((await call('/api/meme', post({ name: '小明', amountText: 'NT$250' }), A)).status).toBe(403)
    await call('/api/ai/redeem', post({ code: 'friends-only' }), A)
    // quota is 2 in tests and a meme costs 3 -> refused
    expect((await call('/api/meme', post({ name: '小明', amountText: 'NT$250', mood: 'angry' }), A)).status).toBe(429)
    expect((await call('/api/meme/nope.png')).status).toBe(404)
  })
})

describe('LINE level 2: mirror, queries, commands, utilities', () => {
  const sig = (body: string) => createHmac('sha256', 'secret').update(body).digest('base64')
  const hook = (call: ReturnType<typeof setup>['call'], events: unknown[]) => {
    const body = JSON.stringify({ destination: 'x', events })
    return call('/api/line/webhook', { method: 'POST', body, headers: { 'x-line-signature': sig(body) } })
  }
  const say = async (call: ReturnType<typeof setup>['call'], text: string, tok = 'r') => {
    await hook(call, [{ type: 'message', replyToken: tok, source: { type: 'user', userId: 'U1' }, message: { type: 'text', id: 't', text } }])
    await new Promise((r) => setTimeout(r, 25))
  }
  const mirror = {
    v: 1, me: { id: 'me', name: '阿賴' }, baseCurrency: 'TWD', payLines: ['808 123456'],
    projects: [
      { id: 'p1', name: '拉麵聚', emoji: '🍜', date: '2026-09-03', category: 'food', currency: 'TWD', total: 900, baseTotal: null, tripId: 't1', payers: ['me'], people: [{ id: 'me', name: '阿賴', amount: 300 }, { id: 'ming', name: '小明', amount: 300 }, { id: 'hua', name: '小華', amount: 300 }], transfers: [{ from: 'ming', to: 'me', amount: 300, currency: 'TWD', remaining: 300, paid: 0, settled: false }, { from: 'hua', to: 'me', amount: 300, currency: 'TWD', remaining: 300, paid: 0, settled: true }] },
      { id: 'p2', name: '計程車', emoji: '🚕', date: '2026-09-04', category: 'transport', currency: 'TWD', total: 300, baseTotal: null, tripId: 't1', payers: ['ming'], people: [{ id: 'me', name: '阿賴', amount: 150 }, { id: 'ming', name: '小明', amount: 150 }], transfers: [{ from: 'me', to: 'ming', amount: 150, currency: 'TWD', remaining: 150, paid: 0, settled: false }] },
    ],
    trips: [{ id: 't1', name: '沖繩', emoji: '🧳' }],
  }
  it('mirror gate, queries by name, commands enqueue/undo, utilities', async () => {
    const { call, lineOut } = setup()
    const { code } = await body(call('/api/line/link-code', post({}), A))
    await say(call, `連結 ${code}`)
    expect((await call('/api/line/mirror', { method: 'POST', body: JSON.stringify(mirror) }, A)).status).toBe(400) // not enabled
    await say(call, '最近帳本')
    expect(JSON.stringify(lineOut.at(-1)!.body)).toContain('等級 2')
    await call('/api/line/settings', post({ mirrorEnabled: true }), A)
    expect((await body(call('/api/line/status', {}, A)))).toMatchObject({ mirrorEnabled: true, summaryEnabled: true })
    expect((await body(call('/api/line/mirror', { method: 'POST', body: JSON.stringify(mirror) }, A))).projects).toBe(2)
    await say(call, '最近帳本')
    expect(JSON.stringify(lineOut.at(-1)!.body)).toContain('carousel')
    await say(call, '拉麵聚')
    let out = JSON.stringify(lineOut.at(-1)!.body)
    expect(out).toContain('拉麵聚')
    expect(out).toContain('/#/p/p1/result')
    await say(call, '小明')
    out = JSON.stringify(lineOut.at(-1)!.body)
    expect(out).toContain('還欠你 NT$150') // 300 owed minus 150 I owe
    await say(call, '沖繩')
    out = JSON.stringify(lineOut.at(-1)!.body)
    expect(out).toContain('最少轉帳')
    expect(out).toContain('小明 → 阿賴')
    await say(call, '催 小明')
    out = JSON.stringify(lineOut.at(-1)!.body)
    expect(out).toContain('808 123456')
    // commands
    await say(call, '小明還了 100')
    let s = await body(call('/api/sync', {}, A))
    expect(s.lineCommands).toHaveLength(1)
    expect(s.lineCommands[0]).toMatchObject({ type: 'settle', personId: 'ming', amount: 100, projectId: 'p1' })
    const undoId = s.lineCommands[0].id
    await hook(call, [{ type: 'postback', replyToken: 'r', source: { type: 'user', userId: 'U1' }, postback: { data: `undo:${undoId}` } }])
    await new Promise((r) => setTimeout(r, 20))
    expect((await body(call('/api/sync', {}, A))).lineCommands).toEqual([])
    await say(call, '拉麵聚 加 阿花')
    await say(call, '刪除 計程車')
    expect(JSON.stringify(lineOut.at(-1)!.body)).toContain('confirm:del:p2')
    await hook(call, [{ type: 'postback', replyToken: 'r', source: { type: 'user', userId: 'U1' }, postback: { data: 'confirm:del:p2' } }])
    await new Promise((r) => setTimeout(r, 20))
    s = await body(call('/api/sync', {}, A))
    expect(s.lineCommands.map((c: { type: string }) => c.type)).toEqual(['addPerson', 'deleteProject'])
    await call('/api/line/ack-commands', post({ ids: s.lineCommands.map((c: { id: number }) => c.id) }), A)
    expect((await body(call('/api/sync', {}, A))).lineCommands).toEqual([])
    await say(call, '路人甲還了')
    expect(JSON.stringify(lineOut.at(-1)!.body)).toContain('找不到')
    // utilities work without mirror too
    await say(call, '900 除 4')
    expect(JSON.stringify(lineOut.at(-1)!.body)).toContain('每人 225')
    // unknown text still becomes a draft
    await say(call, '昨天跟大家吃火鍋 2000 我付的')
    expect((await body(call('/api/sync', {}, A))).lineDrafts).toHaveLength(1)
    // turning mirror off wipes it
    await call('/api/line/settings', post({ mirrorEnabled: false }), A)
    await say(call, '最近帳本')
    expect(JSON.stringify(lineOut.at(-1)!.body)).toContain('等級 2')
  })
})

describe('person share events carry projectId', () => {
  it('routes paid events to the given project and reports per-project paid state', async () => {
    const { call } = setup()
    const { id } = await body(call('/api/share', post({ projectId: 'person_ming', cipher: 'enc', expiresAt: T0 + 86_400_000 }), A))
    await call(`/api/share/${id}/paid`, post({ personId: 'ming_me', projectId: 'p1' }))
    await call(`/api/share/${id}/paid`, post({ personId: 'ming_me', projectId: 'p2' }))
    const pub = await body(call(`/api/share/${id}`))
    expect(pub.paidDetail).toEqual([{ personId: 'ming_me', projectId: 'p1' }, { personId: 'ming_me', projectId: 'p2' }])
    const s = await body(call('/api/sync', {}, A))
    expect(s.events.map((e: { projectId: string }) => e.projectId)).toEqual(['p1', 'p2'])
    await call(`/api/share/${id}/paid`, post({ personId: 'ming_me', projectId: 'p1', kind: 'unpaid' }))
    expect((await body(call(`/api/share/${id}`))).paidDetail).toEqual([{ personId: 'ming_me', projectId: 'p2' }])
  })
})
