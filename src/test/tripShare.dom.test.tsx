// @vitest-environment jsdom
/** 兩個「裝置」透過假的旅程伺服器共編：A 分享、B 加入並改帳本、A 拉回來看到改動、A 刪帳本、B 同步後消失。 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('virtual:pwa-register', () => ({ registerSW: () => () => Promise.resolve() }))
;(globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = 'test'
import { useStore, newProject } from '../store'
import { parseTripSecret } from '../lib/tripSync'

// in-memory /api/trip server
const trips = new Map<string, { token: string; version: number; cipher: string | null }>()
function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input)
  const m = /\/api\/trip(?:\/([^/?]+))?/.exec(url)
  const auth = ((init?.headers as Record<string, string>)?.authorization ?? '').replace('Bearer ', '')
  const json = (o: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } }))
  if (!m) return json({ error: 'nope' }, 404)
  const method = init?.method ?? 'GET'
  if (!m[1] && method === 'POST') {
    const id = 'trip' + trips.size
    trips.set(id, { token: auth, version: 0, cipher: null })
    return json({ id, version: 0 })
  }
  const row = trips.get(m[1]!)
  if (!row || row.token !== auth) return json({ error: 'not_found' }, 404)
  if (method === 'GET') return json({ id: m[1], version: row.version, cipher: row.cipher })
  if (method === 'PUT') {
    const b = JSON.parse(String(init?.body))
    if (b.baseVersion !== row.version) return json({ error: 'conflict', version: row.version, cipher: row.cipher }, 409)
    row.version++
    row.cipher = b.cipher
    return json({ version: row.version })
  }
  if (method === 'DELETE') {
    trips.delete(m[1]!)
    return json({ ok: true })
  }
  return json({ error: 'nope' }, 404)
}

/** 把 store 的資料整包換掉，模擬另一台裝置 */
const snapshot = () => JSON.parse(JSON.stringify(useStore.getState().data))
const load = (d: unknown) => useStore.setState({ data: d as ReturnType<typeof snapshot> })

beforeEach(async () => {
  vi.stubGlobal('fetch', fakeFetch)
  trips.clear()
  await useStore.getState().wipe()
})
afterEach(() => vi.unstubAllGlobals())

describe('trip co-editing', () => {
  it('share → join → edit → sync both ways → delete propagates', async () => {
    const st = useStore.getState()
    // device A
    st.update((d) => (d.me = { ...d.me, id: 'alice', name: 'Alice' }))
    const trip = st.addTrip('沖繩', '🧳')
    const p = st.addProject(undefined, 'food', trip.id)
    st.updateProject(p.id, (pp) => {
      pp.name = '拉麵'
      pp.items[0].price = 900
      pp.people.push({ id: 'bob', name: 'Bob', emoji: '🐰', color: 'mint' })
    })
    const secret = await st.shareTrip(trip.id)
    expect(parseTripSecret(secret)).toBe(secret)
    const shareId = useStore.getState().data.trips![0].share!.id
    expect(trips.get(shareId)?.version).toBe(1)
    const deviceA = snapshot()

    // device B: fresh app, joins as Bob
    await useStore.getState().wipe()
    useStore.getState().update((d) => (d.me = { ...d.me, id: 'bobdev', name: 'Bob 手機' }))
    const tid = await useStore.getState().joinTrip(shareId, secret, 'bob', false)
    expect(tid).toBe(trip.id)
    let b = useStore.getState().data
    expect(b.projects.find((x) => x.id === p.id)?.name).toBe('拉麵')
    expect(b.trips![0].share).toMatchObject({ role: 'member', myPersonId: 'bob' })
    expect(b.friends.map((f) => f.id)).toContain('alice')
    // B adds a project and renames the trip
    const p2 = useStore.getState().addProject(undefined, 'transport', trip.id)
    useStore.getState().updateProject(p2.id, (pp) => (pp.name = '計程車'))
    useStore.getState().updateTrip(trip.id, (t) => (t.name = '沖繩三天'))
    await useStore.getState().syncTrip(trip.id)
    expect(trips.get(shareId)?.version).toBe(2)
    const deviceB = snapshot()

    // back to A: pull
    load(deviceA)
    await useStore.getState().syncTrip(trip.id)
    const a = useStore.getState().data
    expect(a.trips![0].name).toBe('沖繩三天')
    expect(a.projects.map((x) => x.name).sort()).toEqual(['拉麵', '計程車'])
    expect(a.trips![0].share?.role).toBe('owner')
    // A deletes the ramen project
    useStore.getState().deleteProject(p.id)
    await useStore.getState().syncTrip(trip.id)

    // B pulls: ramen gone
    load(deviceB)
    await useStore.getState().syncTrip(trip.id)
    b = useStore.getState().data
    expect(b.projects.map((x) => x.name)).toEqual(['計程車'])

    // owner stops sharing and deletes remote → B's next sync turns it local
    load(useStore.getState().data) // keep B
    trips.delete(shareId)
    await useStore.getState().syncTrip(trip.id)
    expect(useStore.getState().data.trips![0].share).toBeUndefined()
  })
})
