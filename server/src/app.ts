import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createHash, randomBytes } from 'node:crypto'
import type { Db } from './db.ts'

export interface AppOptions {
  db: Db
  corsOrigin?: string
  now?: () => number
  /** Bearer token for GET /api/admin/stats. Unset = endpoint disabled. */
  adminToken?: string
  /** Accounts not seen for this many days are deleted (with their blob and shares). */
  inactiveDays?: number
  /** Web Push sender. Unset = push endpoints return 404. */
  push?: PushSender
}

export interface PushSubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
}
export interface PushSender {
  publicKey: string
  /** Resolves to false when the subscription is gone (404/410) and should be dropped. */
  send(sub: PushSubscriptionRow, payload: string): Promise<boolean>
}

const SYNC_MAX_BYTES = 2 * 1024 * 1024
const SHARE_MAX_BYTES = 256 * 1024
const SHARE_MAX_DAYS = 180
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const RATE_LIMITED = Symbol('rate_limited')
const NOTE_MAX = 2000 // encrypted JSON, so a bit more than the 200-char plaintext
const LABEL_MAX = 40

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}
function newId(bytes = 8) {
  return randomBytes(bytes).toString('base64url')
}

/** Tiny fixed-window rate limiter keyed by client IP (public endpoints only). */
function makeLimiter(limit: number, windowMs: number, now: () => number) {
  const hits = new Map<string, { n: number; at: number }>()
  return (key: string) => {
    const t = now()
    const h = hits.get(key)
    if (!h || t - h.at > windowMs) {
      hits.set(key, { n: 1, at: t })
      if (hits.size > 10_000) hits.clear()
      return true
    }
    h.n += 1
    return h.n <= limit
  }
}

type Vars = { accountId: string }

export function createApp({ db, corsOrigin, now = () => Date.now(), adminToken, inactiveDays = 180, push }: AppOptions) {
  const app = new Hono<{ Variables: Vars }>()
  const q = {
    accountByHash: db.raw.prepare('SELECT id FROM accounts WHERE token_hash = ?'),
    insertAccount: db.raw.prepare('INSERT INTO accounts (id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?)'),
    touchAccount: db.raw.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?'),
    deleteAccount: db.raw.prepare('DELETE FROM accounts WHERE id = ?'),
    blob: db.raw.prepare('SELECT version, cipher, updated_at FROM blobs WHERE account_id = ?'),
    upsertBlob: db.raw.prepare(
      'INSERT INTO blobs (account_id, version, cipher, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET version = excluded.version, cipher = excluded.cipher, updated_at = excluded.updated_at',
    ),
    sharesByAccount: db.raw.prepare('SELECT id, project_id, expires_at, updated_at FROM shares WHERE account_id = ?'),
    shareByProject: db.raw.prepare('SELECT id FROM shares WHERE account_id = ? AND project_id = ?'),
    insertShare: db.raw.prepare('INSERT INTO shares (id, account_id, project_id, cipher, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    updateShare: db.raw.prepare('UPDATE shares SET cipher = ?, expires_at = ?, updated_at = ? WHERE id = ?'),
    shareById: db.raw.prepare('SELECT id, account_id, cipher, expires_at FROM shares WHERE id = ?'),
    deleteShare: db.raw.prepare('DELETE FROM shares WHERE id = ? AND account_id = ?'),
    paidPersons: db.raw.prepare(
      "SELECT person_id, kind FROM share_events WHERE share_id = ? AND id IN (SELECT MAX(id) FROM share_events WHERE share_id = ? GROUP BY person_id)",
    ),
    insertEvent: db.raw.prepare('INSERT INTO share_events (share_id, person_id, kind, created_at, note, label) VALUES (?, ?, ?, ?, ?, ?)'),
    pendingEvents: db.raw.prepare(
      'SELECT e.id, e.share_id, s.project_id, e.person_id, e.kind, e.created_at, e.note, e.label FROM share_events e JOIN shares s ON s.id = e.share_id WHERE s.account_id = ? AND e.acked = 0 ORDER BY e.id',
    ),
    subsByAccount: db.raw.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE account_id = ?'),
    upsertSub: db.raw.prepare(
      'INSERT INTO push_subs (account_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET account_id = excluded.account_id, p256dh = excluded.p256dh, auth = excluded.auth',
    ),
    deleteSub: db.raw.prepare('DELETE FROM push_subs WHERE endpoint = ?'),
    deleteSubOwned: db.raw.prepare('DELETE FROM push_subs WHERE endpoint = ? AND account_id = ?'),
    ackEvent: db.raw.prepare('UPDATE share_events SET acked = 1 WHERE id = ? AND share_id IN (SELECT id FROM shares WHERE account_id = ?)'),
    purgeExpired: db.raw.prepare('DELETE FROM shares WHERE expires_at < ?'),
    purgeInactive: db.raw.prepare('DELETE FROM accounts WHERE last_seen_at < ?'),
    stats: db.raw.prepare(
      `SELECT
        (SELECT COUNT(*) FROM accounts) AS accounts,
        (SELECT COUNT(*) FROM accounts WHERE last_seen_at > ?) AS active_7d,
        (SELECT COUNT(*) FROM accounts WHERE last_seen_at > ?) AS active_30d,
        (SELECT COUNT(*) FROM blobs) AS blobs,
        (SELECT COALESCE(SUM(LENGTH(cipher)), 0) FROM blobs) AS blob_bytes,
        (SELECT COUNT(*) FROM shares) AS shares,
        (SELECT COUNT(*) FROM shares WHERE expires_at > ?) AS shares_live,
        (SELECT COUNT(*) FROM share_events) AS events,
        (SELECT COUNT(*) FROM share_events WHERE acked = 0) AS events_pending,
        (SELECT COUNT(*) FROM push_subs) AS push_subs`,
    ),
  }
  const publicLimiter = makeLimiter(60, 60_000, now)
  // Anyone can mint an account by showing up with a new token; keep one IP from minting thousands.
  const signupLimiter = makeLimiter(10, 3_600_000, now)

  const clientIp = (h: Headers) => h.get('cf-connecting-ip') || h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'

  app.use('/api/*', cors({ origin: corsOrigin ?? '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'] }))
  app.get('/api/health', (c) => c.json({ ok: true, time: now() }))

  // --- auth: bearer token -> account (auto-created on first use) ---
  /** Returns the account id, null when the token is missing/malformed, RATE_LIMITED when a new account may not be created now. */
  const requireAuth = (c: import('hono').Context<{ Variables: Vars }>): string | null | typeof RATE_LIMITED => {
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')
    if (!m || !TOKEN_RE.test(m[1])) return null
    const h = hashToken(m[1])
    const t = now()
    let row = q.accountByHash.get(h) as { id: string } | undefined
    if (!row) {
      if (!signupLimiter(clientIp(c.req.raw.headers))) return RATE_LIMITED
      const id = newId(12)
      q.insertAccount.run(id, h, t, t)
      row = { id }
    } else q.touchAccount.run(t, row.id)
    return row.id
  }
  const authFail = (c: import('hono').Context<{ Variables: Vars }>, r: string | null | typeof RATE_LIMITED) =>
    r === RATE_LIMITED ? c.json({ error: 'rate_limited', reason: 'too many new accounts from this address' }, 429) : c.json({ error: 'unauthorized' }, 401)

  app.use('/api/sync', async (c, next) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    c.set('accountId', accountId)
    await next()
  })

  app.get('/api/admin/stats', (c) => {
    if (!adminToken) return c.json({ error: 'not_found' }, 404)
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')
    if (!m || m[1] !== adminToken) return c.json({ error: 'unauthorized' }, 401)
    const t = now()
    const row = q.stats.get(t - 7 * 86_400_000, t - 30 * 86_400_000, t) as Record<string, number>
    return c.json({ ...row, inactive_days: inactiveDays, time: t })
  })

  // --- sync ---
  app.get('/api/sync', (c) => {
    const accountId = c.get('accountId')
    const blob = q.blob.get(accountId) as { version: number; cipher: string; updated_at: number } | undefined
    const events = q.pendingEvents.all(accountId) as { id: number; share_id: string; project_id: string; person_id: string; kind: string; created_at: number; note: string | null; label: string | null }[]
    const shares = q.sharesByAccount.all(accountId) as { id: string; project_id: string; expires_at: number; updated_at: number }[]
    return c.json({
      version: blob?.version ?? 0,
      cipher: blob?.cipher ?? null,
      updatedAt: blob?.updated_at ?? null,
      events: events.map((e) => ({ id: e.id, shareId: e.share_id, projectId: e.project_id, personId: e.person_id, kind: e.kind, createdAt: e.created_at, note: e.note, label: e.label })),
      push: push ? { enabled: (q.subsByAccount.all(accountId) as unknown[]).length > 0 } : null,
      shares: shares.map((s) => ({ id: s.id, projectId: s.project_id, expiresAt: s.expires_at, updatedAt: s.updated_at })),
    })
  })

  app.put('/api/sync', async (c) => {
    const accountId = c.get('accountId')
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.cipher !== 'string' || !Number.isInteger(body.baseVersion)) return c.json({ error: 'bad_request' }, 400)
    if (body.cipher.length > SYNC_MAX_BYTES) return c.json({ error: 'too_large' }, 413)
    const current = q.blob.get(accountId) as { version: number; cipher: string; updated_at: number } | undefined
    const curVersion = current?.version ?? 0
    if (body.baseVersion !== curVersion) {
      return c.json({ error: 'conflict', version: curVersion, cipher: current?.cipher ?? null, updatedAt: current?.updated_at ?? null }, 409)
    }
    const t = now()
    q.upsertBlob.run(accountId, curVersion + 1, body.cipher, t)
    return c.json({ version: curVersion + 1, updatedAt: t })
  })

  app.delete('/api/sync', (c) => {
    q.deleteAccount.run(c.get('accountId'))
    return c.json({ ok: true })
  })

  // --- shares (owner) ---
  app.post('/api/share', async (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.projectId !== 'string' || !ID_RE.test(body.projectId) || typeof body.cipher !== 'string' || !Number.isInteger(body.expiresAt))
      return c.json({ error: 'bad_request' }, 400)
    if (body.cipher.length > SHARE_MAX_BYTES) return c.json({ error: 'too_large' }, 413)
    const t = now()
    const expiresAt = Math.min(body.expiresAt, t + SHARE_MAX_DAYS * 86_400_000)
    if (expiresAt <= t) return c.json({ error: 'bad_request', reason: 'expired' }, 400)
    const existing = q.shareByProject.get(accountId, body.projectId) as { id: string } | undefined
    if (existing) {
      q.updateShare.run(body.cipher, expiresAt, t, existing.id)
      return c.json({ id: existing.id, expiresAt })
    }
    const id = newId(9)
    q.insertShare.run(id, accountId, body.projectId, body.cipher, expiresAt, t, t)
    return c.json({ id, expiresAt })
  })

  app.post('/api/share/ack', async (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    const body = await c.req.json().catch(() => null)
    if (!body || !Array.isArray(body.ids)) return c.json({ error: 'bad_request' }, 400)
    for (const id of body.ids) if (Number.isInteger(id)) q.ackEvent.run(id, accountId)
    return c.json({ ok: true })
  })

  app.delete('/api/share/:id', async (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    q.deleteShare.run(c.req.param('id'), accountId)
    return c.json({ ok: true })
  })

  // --- shares (public: the friend who received the link) ---
  app.get('/api/share/:id', (c) => {
    if (!publicLimiter(clientIp(c.req.raw.headers))) return c.json({ error: 'rate_limited' }, 429)
    const id = c.req.param('id')
    if (!ID_RE.test(id)) return c.json({ error: 'not_found' }, 404)
    const row = q.shareById.get(id) as { id: string; cipher: string; expires_at: number } | undefined
    if (!row) return c.json({ error: 'not_found' }, 404)
    if (row.expires_at < now()) return c.json({ error: 'expired' }, 410)
    const paid = (q.paidPersons.all(id, id) as { person_id: string; kind: string }[]).filter((e) => e.kind === 'paid').map((e) => e.person_id)
    return c.json({ cipher: row.cipher, expiresAt: row.expires_at, paid })
  })

  app.post('/api/share/:id/paid', async (c) => {
    if (!publicLimiter(clientIp(c.req.raw.headers))) return c.json({ error: 'rate_limited' }, 429)
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => null)
    if (!ID_RE.test(id) || !body || typeof body.personId !== 'string' || !ID_RE.test(body.personId)) return c.json({ error: 'bad_request' }, 400)
    const kind = body.kind === 'unpaid' ? 'unpaid' : 'paid'
    const note = typeof body.note === 'string' && body.note.length > 0 && body.note.length <= NOTE_MAX ? body.note : null
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, LABEL_MAX) : null
    const row = q.shareById.get(id) as { account_id: string; expires_at: number } | undefined
    if (!row) return c.json({ error: 'not_found' }, 404)
    if (row.expires_at < now()) return c.json({ error: 'expired' }, 410)
    q.insertEvent.run(id, body.personId, kind, now(), note, label)
    if (kind === 'paid' && push) notifyOwner(row.account_id, `${label ?? '有人'} 說已經轉帳了 💸`)
    return c.json({ ok: true })
  })

  // --- web push ---
  const notifyOwner = (accountId: string, body: string) => {
    if (!push) return
    const subs = q.subsByAccount.all(accountId) as unknown as PushSubscriptionRow[]
    const payload = JSON.stringify({ title: '반반 BanBan', body, url: '/', tag: 'banban-paid' })
    for (const sub of subs) {
      push
        .send(sub, payload)
        .then((alive) => {
          if (!alive) q.deleteSub.run(sub.endpoint)
        })
        .catch((e) => console.error('push failed', e))
    }
  }
  app.get('/api/push/vapid', (c) => (push ? c.json({ publicKey: push.publicKey }) : c.json({ error: 'not_found' }, 404)))
  app.post('/api/push/subscribe', async (c) => {
    if (!push) return c.json({ error: 'not_found' }, 404)
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    const body = await c.req.json().catch(() => null)
    const ep = body?.endpoint
    const keys = body?.keys
    if (typeof ep !== 'string' || !/^https:\/\/\S{10,2000}$/.test(ep) || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') return c.json({ error: 'bad_request' }, 400)
    q.upsertSub.run(accountId, ep, keys.p256dh, keys.auth, now())
    return c.json({ ok: true })
  })
  app.delete('/api/push/subscribe', async (c) => {
    if (!push) return c.json({ error: 'not_found' }, 404)
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    const body = await c.req.json().catch(() => null)
    if (typeof body?.endpoint === 'string') q.deleteSubOwned.run(body.endpoint, accountId)
    return c.json({ ok: true })
  })
  app.post('/api/push/test', (c) => {
    if (!push) return c.json({ error: 'not_found' }, 404)
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    const n = (q.subsByAccount.all(accountId) as unknown[]).length
    if (!n) return c.json({ error: 'no_subscription' }, 400)
    notifyOwner(accountId, '推播沒問題，之後朋友按「我轉了」會通知你 🔔')
    return c.json({ ok: true, sent: n })
  })

  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'server_error' }, 500)
  })

  const purgeExpired = () => q.purgeExpired.run(now() - 7 * 86_400_000)
  const purgeInactive = () => {
    const r = q.purgeInactive.run(now() - inactiveDays * 86_400_000)
    return Number(r.changes)
  }
  return { app, purgeExpired, purgeInactive }
}
