import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createHash, randomBytes } from 'node:crypto'
import type { Db } from './db.ts'
import { readFileSync, statSync } from 'node:fs'
import { renderOg } from './og.ts'
import type { AiParser } from './ai.ts'
import { LINE_HELP, type LineClient } from './line.ts'
import { composeMeme, memePrompt, memeStore, MEME_LINES, type ImageGen, type Mood } from './meme.ts'
import { CMD_HELP, findPerson, findProject, findTrip, parseCommand, personFlex, projectFlex, recentFlex, reminderTextFor, sanitizeMirror, tripFlex, utility, type LineCommand, type Mirror } from './lineMirror.ts'
import { HELP_QR, inboxText, quickReply, receiptFlex, summaryFlex, textDraftReply, textMsg, weeklyText, type Summary } from './lineMessages.ts'
import { callChat, callProvider, isPublicHttpsUrl, type AiFormat } from '../../src/lib/receiptAi.ts'

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
  /** Absolute origin for og:image / og:url, e.g. https://spilt.chung.men */
  publicOrigin?: string
  /** Path to the built share page (dist/s/index.html); OG tags get injected into it for /s/:id. */
  shareHtml?: string
  /** Receipt parser backed by an LLM; `enabled: false` = endpoint reports unavailable. */
  ai?: AiParser
  /** Per-account daily quota for /api/parse. */
  aiDailyQuota?: number
  /** Hard ceiling for everyone combined per day (protects the API bill). */
  aiGlobalDaily?: number
  /** Users must redeem this code once before /api/parse works. Unset + aiOpen=false = only admin-allowed accounts. */
  aiInviteCode?: string
  /** true = everyone may use AI without a code (not recommended). */
  aiOpen?: boolean
  /** Test hook for the BYOK proxy. */
  byokFetch?: typeof fetch
  /** LINE Messaging API client; `enabled: false` = webhook returns 404. */
  line?: LineClient
  /** 梗圖：AI 底圖產生器＋存放目錄 */
  imageGen?: ImageGen
  memeDir?: string
  /** Test hook: replace the PNG renderer. */
  renderOgImage?: (i: { title: string; subtitle: string; mood?: 'happy' | 'wow' | 'sleepy' }) => Promise<Buffer>
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
const OG_TITLE_MAX = 60
const TRIP_MAX_BYTES = 4 * 1024 * 1024
const OG_DESC = '點開看自己的份，轉完按「我轉了」就好 💸'

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function cleanOgTitle(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, OG_TITLE_MAX)
  return t || null
}

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

export function createApp({ db, corsOrigin, now = () => Date.now(), adminToken, inactiveDays = 180, push, publicOrigin = '', shareHtml, renderOgImage = renderOg, ai, aiDailyQuota = 40, aiGlobalDaily = 300, aiInviteCode, aiOpen = false, byokFetch, line, imageGen, memeDir }: AppOptions) {
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
    insertShare: db.raw.prepare('INSERT INTO shares (id, account_id, project_id, cipher, expires_at, created_at, updated_at, og_title) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    updateShare: db.raw.prepare('UPDATE shares SET cipher = ?, expires_at = ?, updated_at = ? WHERE id = ?'),
    updateOgTitle: db.raw.prepare('UPDATE shares SET og_title = ? WHERE id = ?'),
    shareById: db.raw.prepare('SELECT id, account_id, cipher, expires_at, og_title, updated_at FROM shares WHERE id = ?'),
    deleteShare: db.raw.prepare('DELETE FROM shares WHERE id = ? AND account_id = ?'),
    paidPersons: db.raw.prepare(
      "SELECT person_id, kind, project_id FROM share_events WHERE share_id = ? AND id IN (SELECT MAX(id) FROM share_events WHERE share_id = ? GROUP BY person_id, COALESCE(project_id, ''))",
    ),
    insertEvent: db.raw.prepare('INSERT INTO share_events (share_id, person_id, kind, created_at, note, label, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    pendingEvents: db.raw.prepare(
      'SELECT e.id, e.share_id, COALESCE(e.project_id, s.project_id) AS project_id, e.person_id, e.kind, e.created_at, e.note, e.label FROM share_events e JOIN shares s ON s.id = e.share_id WHERE s.account_id = ? AND e.acked = 0 ORDER BY e.id',
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
    tripInsert: db.raw.prepare('INSERT INTO trips (id, token_hash, version, cipher, created_at, updated_at, last_seen_at) VALUES (?, ?, 0, NULL, ?, ?, ?)'),
    tripGet: db.raw.prepare('SELECT id, token_hash, version, cipher, updated_at FROM trips WHERE id = ?'),
    tripTouch: db.raw.prepare('UPDATE trips SET last_seen_at = ? WHERE id = ?'),
    tripPut: db.raw.prepare('UPDATE trips SET version = ?, cipher = ?, updated_at = ?, last_seen_at = ? WHERE id = ?'),
    tripDelete: db.raw.prepare('DELETE FROM trips WHERE id = ?'),
    tripPurge: db.raw.prepare('DELETE FROM trips WHERE last_seen_at < ?'),
    tripCount: db.raw.prepare('SELECT COUNT(*) AS n FROM trips'),
    lineByUser: db.raw.prepare('SELECT account_id, display_name, push_enabled, summary_enabled, mirror_enabled FROM line_links WHERE line_user_id = ?'),
    lineByAccount: db.raw.prepare('SELECT line_user_id, display_name, push_enabled, summary_enabled, weekly_enabled, mirror_enabled, created_at FROM line_links WHERE account_id = ?'),
    lineSetSettings: db.raw.prepare('UPDATE line_links SET push_enabled = ?, summary_enabled = ?, weekly_enabled = ?, mirror_enabled = ? WHERE account_id = ?'),
    lineMirrorPut: db.raw.prepare('INSERT INTO line_mirrors (account_id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at'),
    lineMirrorGet: db.raw.prepare('SELECT payload FROM line_mirrors WHERE account_id = ?'),
    lineMirrorDelete: db.raw.prepare('DELETE FROM line_mirrors WHERE account_id = ?'),
    lineCmdInsert: db.raw.prepare('INSERT INTO line_commands (account_id, payload, created_at) VALUES (?, ?, ?)'),
    lineCmdLast: db.raw.prepare('SELECT id FROM line_commands WHERE account_id = ? ORDER BY id DESC LIMIT 1'),
    lineCmdPending: db.raw.prepare('SELECT id, payload, created_at FROM line_commands WHERE account_id = ? AND consumed = 0 ORDER BY id LIMIT 50'),
    lineCmdAck: db.raw.prepare('UPDATE line_commands SET consumed = 1 WHERE id = ? AND account_id = ?'),
    lineCmdCancel: db.raw.prepare('DELETE FROM line_commands WHERE id = ? AND account_id = ? AND consumed = 0'),
    lineCmdPurge: db.raw.prepare('DELETE FROM line_commands WHERE consumed = 1 OR created_at < ?'),
    lineSummaryPut: db.raw.prepare('INSERT INTO line_summaries (account_id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at'),
    lineSummaryGet: db.raw.prepare('SELECT payload, updated_at FROM line_summaries WHERE account_id = ?'),
    lineSummaryDelete: db.raw.prepare('DELETE FROM line_summaries WHERE account_id = ?'),
    lineWeeklyDue: db.raw.prepare('SELECT l.line_user_id, l.account_id, s.payload FROM line_links l JOIN line_summaries s ON s.account_id = l.account_id WHERE l.weekly_enabled = 1 AND l.summary_enabled = 1 AND l.last_weekly_at < ?'),
    lineWeeklyMark: db.raw.prepare('UPDATE line_links SET last_weekly_at = ? WHERE account_id = ?'),
    lineMemberSeen: db.raw.prepare('INSERT INTO line_group_members (group_id, user_id, display_name, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(group_id, user_id) DO UPDATE SET display_name = COALESCE(excluded.display_name, line_group_members.display_name), last_seen_at = excluded.last_seen_at'),
    lineLink: db.raw.prepare('INSERT INTO line_links (line_user_id, account_id, display_name, push_enabled, created_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(line_user_id) DO UPDATE SET account_id = excluded.account_id, display_name = excluded.display_name, created_at = excluded.created_at'),
    lineUnlink: db.raw.prepare('DELETE FROM line_links WHERE account_id = ?'),
    lineSetPush: db.raw.prepare('UPDATE line_links SET push_enabled = ? WHERE account_id = ?'),
    lineCodeInsert: db.raw.prepare('INSERT INTO line_link_codes (code, account_id, expires_at) VALUES (?, ?, ?)'),
    lineCodeGet: db.raw.prepare('SELECT account_id, expires_at FROM line_link_codes WHERE code = ?'),
    lineCodeDelete: db.raw.prepare('DELETE FROM line_link_codes WHERE code = ? OR expires_at < ?'),
    lineDraftInsert: db.raw.prepare('INSERT INTO line_drafts (account_id, kind, payload, created_at, origin) VALUES (?, ?, ?, ?, ?)'),
    lineDraftLast: db.raw.prepare('SELECT id FROM line_drafts WHERE account_id = ? ORDER BY id DESC LIMIT 1'),
    lineDraftsPending: db.raw.prepare('SELECT id, kind, payload, created_at FROM line_drafts WHERE account_id = ? AND consumed = 0 ORDER BY id LIMIT 50'),
    lineDraftCount: db.raw.prepare('SELECT COUNT(*) AS n FROM line_drafts WHERE account_id = ? AND consumed = 0'),
    lineDraftAck: db.raw.prepare('UPDATE line_drafts SET consumed = 1 WHERE id = ? AND account_id = ?'),
    lineDraftPurge: db.raw.prepare('DELETE FROM line_drafts WHERE consumed = 1 OR created_at < ?'),
    aiFlag: db.raw.prepare('SELECT ai_allowed, note FROM account_flags WHERE account_id = ?'),
    setAiFlag: db.raw.prepare('INSERT INTO account_flags (account_id, ai_allowed, note, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET ai_allowed = excluded.ai_allowed, note = COALESCE(excluded.note, account_flags.note), updated_at = excluded.updated_at'),
    aiUsed: db.raw.prepare('SELECT n FROM ai_usage WHERE account_id = ? AND day = ?'),
    aiBump: db.raw.prepare('INSERT INTO ai_usage (account_id, day, n) VALUES (?, ?, 1) ON CONFLICT(account_id, day) DO UPDATE SET n = n + 1'),
    aiGlobal: db.raw.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM ai_usage WHERE day = ?'),
    aiAdminList: db.raw.prepare(
      `SELECT a.id, a.created_at, a.last_seen_at, COALESCE(f.ai_allowed, 0) AS ai_allowed, f.note,
        COALESCE((SELECT n FROM ai_usage u WHERE u.account_id = a.id AND u.day = ?), 0) AS today,
        COALESCE((SELECT SUM(n) FROM ai_usage u WHERE u.account_id = a.id), 0) AS total
       FROM accounts a LEFT JOIN account_flags f ON f.account_id = a.id
       WHERE f.ai_allowed = 1 OR EXISTS (SELECT 1 FROM ai_usage u WHERE u.account_id = a.id)
       ORDER BY total DESC`,
    ),
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
        (SELECT COUNT(*) FROM push_subs) AS push_subs,
        (SELECT COUNT(*) FROM trips) AS trips,
        (SELECT COUNT(*) FROM line_links) AS line_links`,
    ),
  }
  const publicLimiter = makeLimiter(60, 60_000, now)
  // Anyone can mint an account by showing up with a new token; keep one IP from minting thousands.
  const signupLimiter = makeLimiter(10, 3_600_000, now)

  const clientIp = (h: Headers) => h.get('cf-connecting-ip') || h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'

  app.use('/api/*', cors({ origin: corsOrigin ?? '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'] }))
  app.get('/api/health', (c) => c.json({ ok: true, time: now(), ai: !!ai?.enabled, push: !!push }))

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
      lineDrafts: line?.enabled ? (q.lineDraftsPending.all(accountId) as { id: number; kind: string; payload: string; created_at: number }[]).map((d) => ({ id: d.id, kind: d.kind, payload: JSON.parse(d.payload), createdAt: d.created_at })) : [],
      lineCommands: line?.enabled ? (q.lineCmdPending.all(accountId) as { id: number; payload: string; created_at: number }[]).map((d) => ({ id: d.id, ...(JSON.parse(d.payload) as LineCommand), createdAt: d.created_at })) : [],
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
    const hasOg = 'ogTitle' in body
    const ogTitle = cleanOgTitle(body.ogTitle)
    const existing = q.shareByProject.get(accountId, body.projectId) as { id: string } | undefined
    if (existing) {
      q.updateShare.run(body.cipher, expiresAt, t, existing.id)
      if (hasOg) q.updateOgTitle.run(ogTitle, existing.id)
      return c.json({ id: existing.id, expiresAt })
    }
    const id = newId(9)
    q.insertShare.run(id, accountId, body.projectId, body.cipher, expiresAt, t, t, ogTitle)
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
    const rows = q.paidPersons.all(id, id) as { person_id: string; kind: string; project_id: string | null }[]
    const paid = rows.filter((e) => e.kind === 'paid').map((e) => e.person_id)
    const paidDetail = rows.filter((e) => e.kind === 'paid').map((e) => ({ personId: e.person_id, projectId: e.project_id }))
    return c.json({ cipher: row.cipher, expiresAt: row.expires_at, paid, paidDetail })
  })

  // --- Open Graph: preview image + share page HTML with meta tags (crawlers never see the #key) ---
  app.get('/api/share/:id/og.png', async (c) => {
    if (!publicLimiter(clientIp(c.req.raw.headers))) return c.json({ error: 'rate_limited' }, 429)
    const id = c.req.param('id')
    const row = ID_RE.test(id) ? (q.shareById.get(id) as { og_title: string | null; expires_at: number } | undefined) : undefined
    const expired = !row || row.expires_at < now()
    const title = expired ? (row ? '這個分帳連結過期了' : '找不到這個分帳') : (row.og_title ?? '有人幫你先付了')
    const subtitle = expired ? '請對方再分享一次' : '朋友幫大家先墊了，來看看你的份'
    try {
      const png = await renderOgImage({ title, subtitle, mood: expired ? 'sleepy' : 'wow' })
      return c.body(new Uint8Array(png), 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' })
    } catch (e) {
      console.error('og render failed', e)
      return c.json({ error: 'server_error' }, 500)
    }
  })

  let tpl: { html: string; mtime: number } | null = null
  const loadShareHtml = () => {
    if (!shareHtml) return null
    try {
      const m = statSync(shareHtml).mtimeMs
      if (!tpl || tpl.mtime !== m) tpl = { html: readFileSync(shareHtml, 'utf8'), mtime: m }
      return tpl.html
    } catch {
      return null
    }
  }
  app.get('/s/:id', (c) => {
    const id = c.req.param('id')
    const html = loadShareHtml()
    if (!html) return c.json({ error: 'not_found' }, 404)
    const row = ID_RE.test(id) ? (q.shareById.get(id) as { og_title: string | null; expires_at: number; updated_at: number } | undefined) : undefined
    const expired = !row || row.expires_at < now()
    const title = expired ? (row ? '分帳連結過期了' : '找不到這個分帳') : (row.og_title ?? '有人幫你先付了 💸')
    const desc = expired ? '請對方再分享一次新的連結。' : OG_DESC
    const img = `${publicOrigin}/api/share/${encodeURIComponent(id)}/og.png?v=${row?.updated_at ?? 0}`
    const url = `${publicOrigin}/s/${encodeURIComponent(id)}`
    const meta = [
      `<title>${escHtml(title)} · 반반 BanBan</title>`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="반반 BanBan 半半分帳">`,
      `<meta property="og:title" content="${escHtml(title)}">`,
      `<meta property="og:description" content="${escHtml(desc)}">`,
      `<meta property="og:image" content="${escHtml(img)}">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta property="og:url" content="${escHtml(url)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="description" content="${escHtml(desc)}">`,
    ].join('\n    ')
    const out = html.replace(/<title>[^<]*<\/title>/, '').replace('</head>', `    ${meta}\n  </head>`)
    return c.html(out, 200, { 'cache-control': 'no-cache', 'x-robots-tag': 'noindex' })
  })

  app.post('/api/share/:id/paid', async (c) => {
    if (!publicLimiter(clientIp(c.req.raw.headers))) return c.json({ error: 'rate_limited' }, 429)
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => null)
    if (!ID_RE.test(id) || !body || typeof body.personId !== 'string' || !ID_RE.test(body.personId)) return c.json({ error: 'bad_request' }, 400)
    const kind = body.kind === 'unpaid' ? 'unpaid' : 'paid'
    const note = typeof body.note === 'string' && body.note.length > 0 && body.note.length <= NOTE_MAX ? body.note : null
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, LABEL_MAX) : null
    // 「給某人的連結」跨多本帳：事件要指回原本的帳本
    const projectId = typeof body.projectId === 'string' && ID_RE.test(body.projectId) ? body.projectId : null
    const row = q.shareById.get(id) as { account_id: string; expires_at: number } | undefined
    if (!row) return c.json({ error: 'not_found' }, 404)
    if (row.expires_at < now()) return c.json({ error: 'expired' }, 410)
    q.insertEvent.run(id, body.personId, kind, now(), note, label, projectId)
    if (kind === 'paid' && push) notifyOwner(row.account_id, `${label ?? '有人'} 說已經轉帳了 💸`)
    return c.json({ ok: true })
  })

  // --- AI receipt parsing: invite-code / admin allowlist + per-account and global daily quotas (content is never stored) ---
  // 以台灣時間算「今天」，不然晚上八點就換日
  const dayOf = () => new Date(now()).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
  const aiAllowedFor = (accountId: string) => aiOpen || ((q.aiFlag.get(accountId) as { ai_allowed: number } | undefined)?.ai_allowed ?? 0) === 1
  const aiStatusFor = (accountId: string) => {
    const day = dayOf()
    const used = (q.aiUsed.get(accountId, day) as { n: number } | undefined)?.n ?? 0
    const global = (q.aiGlobal.get(day) as { n: number }).n
    return {
      available: !!ai?.enabled,
      allowed: !!ai?.enabled && aiAllowedFor(accountId),
      needsCode: !!aiInviteCode && !aiOpen,
      used,
      quota: aiDailyQuota,
      remaining: Math.max(0, Math.min(aiDailyQuota - used, aiGlobalDaily - global)),
      accountId,
    }
  }
  const redeemLimiter = makeLimiter(10, 3_600_000, now)

  app.get('/api/ai/status', (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    return c.json(aiStatusFor(accountId))
  })
  app.post('/api/ai/redeem', async (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    if (!redeemLimiter(clientIp(c.req.raw.headers))) return c.json({ error: 'rate_limited' }, 429)
    const body = await c.req.json().catch(() => null)
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!aiInviteCode || !code || code !== aiInviteCode) return c.json({ error: 'bad_code' }, 403)
    q.setAiFlag.run(accountId, 1, 'invite', now())
    return c.json(aiStatusFor(accountId))
  })
  app.post('/api/parse', async (c) => {
    if (!ai?.enabled) return c.json({ error: 'ai_disabled' }, 404)
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    if (!aiAllowedFor(accountId)) return c.json({ error: 'not_allowed', needsCode: !!aiInviteCode }, 403)
    const st = aiStatusFor(accountId)
    if (st.remaining <= 0) return c.json({ error: 'quota', quota: aiDailyQuota, used: st.used }, 429)
    const body = await c.req.json().catch(() => null)
    const text = typeof body?.text === 'string' ? body.text.slice(0, 8000) : undefined
    const img = body?.image
    const image =
      img && typeof img.base64 === 'string' && img.base64.length < 6_000_000 && /^image\/(jpeg|png|webp|gif)$/.test(img.mediaType ?? '') ? { mediaType: img.mediaType as string, base64: img.base64 as string } : undefined
    if (!text && !image) return c.json({ error: 'bad_request' }, 400)
    q.aiBump.run(accountId, dayOf())
    try {
      const out = await ai.parse({ text, image })
      return c.json({ ...out, remaining: st.remaining - 1 })
    } catch (e) {
      console.error('ai parse failed', (e as Error).message)
      return c.json({ error: 'ai_failed' }, 502)
    }
  })
  // 站方 AI 一般對話（同樣的權限與額度）
  const readChat = (body: { system?: unknown; user?: unknown; image?: unknown; maxTokens?: unknown }) => {
    const system = typeof body?.system === 'string' ? body.system.slice(0, 6000) : ''
    const user = typeof body?.user === 'string' ? body.user.slice(0, 12000) : ''
    const img = body?.image as { mediaType?: string; base64?: string } | undefined
    const image = img && typeof img.base64 === 'string' && img.base64.length < 6_000_000 && /^image\/(jpeg|png|webp|gif)$/.test(img.mediaType ?? '') ? { mediaType: img.mediaType as string, base64: img.base64 } : undefined
    const maxTokens = Math.min(8000, Math.max(200, Number(body?.maxTokens) || 4000))
    return system && (user || image) ? { system, user, image, maxTokens } : null
  }
  app.post('/api/ai/chat', async (c) => {
    if (!ai?.enabled) return c.json({ error: 'ai_disabled' }, 404)
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    if (!aiAllowedFor(accountId)) return c.json({ error: 'not_allowed', needsCode: !!aiInviteCode }, 403)
    const st = aiStatusFor(accountId)
    if (st.remaining <= 0) return c.json({ error: 'quota', quota: aiDailyQuota, used: st.used }, 429)
    const input = readChat((await c.req.json().catch(() => null)) ?? {})
    if (!input) return c.json({ error: 'bad_request' }, 400)
    q.aiBump.run(accountId, dayOf())
    try {
      return c.json({ text: await ai.chat(input), remaining: st.remaining - 1 })
    } catch (e) {
      console.error('ai chat failed', (e as Error).message.slice(0, 120))
      return c.json({ error: 'ai_failed' }, 502)
    }
  })

  // BYOK 代轉：瀏覽器被 CORS 擋住時才會走這裡。金鑰只用於本次請求、不寫入任何地方；只准 https 公網位址。
  const byokLimiter = makeLimiter(60, 3_600_000, now)
  app.post('/api/parse/byok', async (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    if (!byokLimiter(clientIp(c.req.raw.headers))) return c.json({ error: 'rate_limited' }, 429)
    const body = await c.req.json().catch(() => null)
    const p = body?.provider
    const format: AiFormat = p?.format === 'anthropic' ? 'anthropic' : 'openai'
    if (!p || typeof p.baseUrl !== 'string' || typeof p.model !== 'string' || typeof p.apiKey !== 'string' || !p.apiKey || p.apiKey.length > 500) return c.json({ error: 'bad_request' }, 400)
    if (!isPublicHttpsUrl(p.baseUrl)) return c.json({ error: 'bad_url', reason: 'baseUrl 必須是 https 的公開網址' }, 400)
    const text = typeof body?.text === 'string' ? body.text.slice(0, 8000) : undefined
    const img = body?.image
    const image =
      img && typeof img.base64 === 'string' && img.base64.length < 6_000_000 && /^image\/(jpeg|png|webp|gif)$/.test(img.mediaType ?? '') ? { mediaType: img.mediaType as string, base64: img.base64 as string } : undefined
    if (!text && !image) return c.json({ error: 'bad_request' }, 400)
    try {
      const out = await callProvider({ format, baseUrl: p.baseUrl, model: String(p.model).slice(0, 100), apiKey: p.apiKey }, { text, image }, { fetchFn: byokFetch })
      return c.json(out)
    } catch (e) {
      // 不要把金鑰寫進 log：只記錄錯誤訊息前 120 字
      const msg = (e as Error).message ?? 'failed'
      console.error('byok parse failed:', msg.slice(0, 120))
      return c.json({ error: 'provider_failed', message: msg.slice(0, 200) }, 502)
    }
  })

  app.post('/api/ai/byok', async (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    if (!byokLimiter(clientIp(c.req.raw.headers))) return c.json({ error: 'rate_limited' }, 429)
    const body = await c.req.json().catch(() => null)
    const p = body?.provider
    const format: AiFormat = p?.format === 'anthropic' ? 'anthropic' : 'openai'
    if (!p || typeof p.baseUrl !== 'string' || typeof p.model !== 'string' || typeof p.apiKey !== 'string' || !p.apiKey || p.apiKey.length > 500) return c.json({ error: 'bad_request' }, 400)
    if (!isPublicHttpsUrl(p.baseUrl)) return c.json({ error: 'bad_url', reason: 'baseUrl 必須是 https 的公開網址' }, 400)
    const input = readChat(body ?? {})
    if (!input) return c.json({ error: 'bad_request' }, 400)
    try {
      return c.json({ text: await callChat({ format, baseUrl: p.baseUrl, model: String(p.model).slice(0, 100), apiKey: p.apiKey }, input, { fetchFn: byokFetch }) })
    } catch (e) {
      const msg = (e as Error).message ?? 'failed'
      console.error('byok chat failed:', msg.slice(0, 120))
      return c.json({ error: 'provider_failed', message: msg.slice(0, 200) }, 502)
    }
  })

  // admin: who may use AI and how much they used
  const adminOk = (c: import('hono').Context<{ Variables: Vars }>) => {
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')
    return !!adminToken && !!m && m[1] === adminToken
  }
  app.get('/api/admin/ai', (c) => {
    if (!adminOk(c)) return c.json({ error: 'unauthorized' }, 401)
    const day = dayOf()
    return c.json({ day, globalUsed: (q.aiGlobal.get(day) as { n: number }).n, globalDaily: aiGlobalDaily, quota: aiDailyQuota, open: aiOpen, inviteCodeSet: !!aiInviteCode, accounts: q.aiAdminList.all(day) })
  })
  app.post('/api/admin/ai', async (c) => {
    if (!adminOk(c)) return c.json({ error: 'unauthorized' }, 401)
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.accountId !== 'string' || typeof body.allow !== 'boolean') return c.json({ error: 'bad_request' }, 400)
    if (!(q.accountByHash as unknown as { get: unknown }) || !db.raw.prepare('SELECT 1 FROM accounts WHERE id = ?').get(body.accountId)) return c.json({ error: 'not_found' }, 404)
    q.setAiFlag.run(body.accountId, body.allow ? 1 : 0, typeof body.note === 'string' ? body.note.slice(0, 60) : null, now())
    return c.json({ ok: true })
  })

  // --- 共編旅程：拿到連結（id + 金鑰）的人都能讀寫；伺服器只存密文與版本號。token = HKDF(金鑰) 派生，伺服器存 hash ---
  const tripCreateLimiter = makeLimiter(20, 3_600_000, now)
  const tripToken = (c: import('hono').Context<{ Variables: Vars }>) => {
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')
    return m && TOKEN_RE.test(m[1]) ? m[1] : null
  }
  const tripAuth = (c: import('hono').Context<{ Variables: Vars }>, id: string) => {
    const tok = tripToken(c)
    if (!tok || !ID_RE.test(id)) return null
    const row = q.tripGet.get(id) as { id: string; token_hash: string; version: number; cipher: string | null; updated_at: number } | undefined
    if (!row || row.token_hash !== hashToken(tok)) return null
    q.tripTouch.run(now(), id)
    return row
  }
  app.post('/api/trip', (c) => {
    const tok = tripToken(c)
    if (!tok) return c.json({ error: 'unauthorized' }, 401)
    if (!tripCreateLimiter(clientIp(c.req.raw.headers))) return c.json({ error: 'rate_limited' }, 429)
    const id = newId(9)
    const t = now()
    q.tripInsert.run(id, hashToken(tok), t, t, t)
    return c.json({ id, version: 0 })
  })
  app.get('/api/trip/:id', (c) => {
    const row = tripAuth(c, c.req.param('id'))
    if (!row) return c.json({ error: 'not_found' }, 404)
    return c.json({ id: row.id, version: row.version, cipher: row.cipher, updatedAt: row.updated_at })
  })
  app.put('/api/trip/:id', async (c) => {
    const row = tripAuth(c, c.req.param('id'))
    if (!row) return c.json({ error: 'not_found' }, 404)
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.cipher !== 'string' || !Number.isInteger(body.baseVersion)) return c.json({ error: 'bad_request' }, 400)
    if (body.cipher.length > TRIP_MAX_BYTES) return c.json({ error: 'too_large' }, 413)
    if (body.baseVersion !== row.version) return c.json({ error: 'conflict', version: row.version, cipher: row.cipher, updatedAt: row.updated_at }, 409)
    const t = now()
    q.tripPut.run(row.version + 1, body.cipher, t, t, row.id)
    return c.json({ version: row.version + 1, updatedAt: t })
  })
  app.delete('/api/trip/:id', (c) => {
    const row = tripAuth(c, c.req.param('id'))
    if (!row) return c.json({ error: 'not_found' }, 404)
    q.tripDelete.run(row.id)
    return c.json({ ok: true })
  })

  // --- web push ---
  const notifyOwner = (accountId: string, body: string) => {
    const subs = push ? (q.subsByAccount.all(accountId) as unknown as PushSubscriptionRow[]) : []
    if (line?.enabled) {
      // push_enabled：0 關、1 只在沒有 Web Push 時才用 LINE（省額度，預設）、2 一律用 LINE
      const l = q.lineByAccount.get(accountId) as { line_user_id: string; push_enabled: number } | undefined
      const useLine = l && (l.push_enabled === 2 || (l.push_enabled === 1 && subs.length === 0))
      if (useLine) line.push(l.line_user_id, [{ type: 'text', text: `💸 ${body}\n打開 App 看看 👉 https://spilt.chung.men` }]).catch(() => {})
    }
    if (!push) return
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
  // --- 催款梗圖（吃 AI 額度；圖公開但 id 不可猜，7 天後清） ---
  const memes = memeDir ? memeStore(memeDir) : null
  app.post('/api/meme', async (c) => {
    if (!imageGen?.enabled || !memes) return c.json({ error: 'meme_disabled' }, 404)
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    if (!aiAllowedFor(accountId)) return c.json({ error: 'not_allowed' }, 403)
    const st = aiStatusFor(accountId)
    if (st.remaining <= 2) return c.json({ error: 'quota' }, 429) // 生圖算 3 次
    const body = await c.req.json().catch(() => null)
    const mood: Mood = ['cute', 'angry', 'sad', 'party'].includes(body?.mood) ? body.mood : 'cute'
    const name = typeof body?.name === 'string' ? body.name : ''
    const amountText = typeof body?.amountText === 'string' ? body.amountText : ''
    if (!name || !amountText) return c.json({ error: 'bad_request' }, 400)
    const line = typeof body?.line === 'string' && body.line.trim() ? body.line : MEME_LINES[mood][Math.floor(Math.random() * MEME_LINES[mood].length)]
    for (let i = 0; i < 3; i++) q.aiBump.run(accountId, dayOf())
    try {
      const base = await imageGen.generate(memePrompt(mood))
      const png = await composeMeme(base, { name, amountText, line })
      const id = memes.save(png)
      return c.json({ id, url: `${publicOrigin}/api/meme/${id}.png` })
    } catch (e) {
      console.error('meme failed', (e as Error).message?.slice(0, 160))
      return c.json({ error: 'meme_failed', message: (e as Error).message?.slice(0, 160) }, 502)
    }
  })
  app.get('/api/meme/:file', (c) => {
    if (!memes) return c.json({ error: 'not_found' }, 404)
    const id = c.req.param('file').replace(/\.png$/, '')
    const buf = memes.read(id)
    if (!buf) return c.json({ error: 'not_found' }, 404)
    return c.body(new Uint8Array(buf), 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' })
  })

  // --- LINE 機器人：連結碼、webhook、收件匣 ---
  const lineCodeLimiter = makeLimiter(20, 3_600_000, now)
  app.get('/api/line/status', (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    const l = q.lineByAccount.get(accountId) as { line_user_id: string; display_name: string | null; push_enabled: number; summary_enabled: number; weekly_enabled: number; mirror_enabled: number; created_at: number } | undefined
    return c.json({ available: !!line?.enabled, linked: !!l, displayName: l?.display_name ?? null, pushEnabled: !!l?.push_enabled, pushMode: (['off', 'fallback', 'always'] as const)[l?.push_enabled ?? 0] ?? 'always', summaryEnabled: !!l?.summary_enabled, weeklyEnabled: !!l?.weekly_enabled, mirrorEnabled: !!l?.mirror_enabled, pending: (q.lineDraftCount.get(accountId) as { n: number }).n })
  })
  app.post('/api/line/link-code', (c) => {
    if (!line?.enabled) return c.json({ error: 'line_disabled' }, 404)
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    if (!lineCodeLimiter(clientIp(c.req.raw.headers))) return c.json({ error: 'rate_limited' }, 429)
    q.lineCodeDelete.run('', now())
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const bytes = randomBytes(6)
    const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
    q.lineCodeInsert.run(code, accountId, now() + 15 * 60_000)
    return c.json({ code, expiresIn: 900 })
  })
  app.delete('/api/line/link', (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    q.lineUnlink.run(accountId)
    return c.json({ ok: true })
  })
  app.post('/api/line/push', async (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    const body = await c.req.json().catch(() => null)
    q.lineSetPush.run(body?.enabled ? 1 : 0, accountId)
    return c.json({ ok: true })
  })
  app.post('/api/line/settings', async (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    const body = await c.req.json().catch(() => null)
    const l = q.lineByAccount.get(accountId) as { push_enabled: number; summary_enabled: number; weekly_enabled: number; mirror_enabled: number } | undefined
    if (!l) return c.json({ error: 'not_linked' }, 400)
    const pick = (k: string, cur: number) => (typeof body?.[k] === 'boolean' ? (body[k] ? 1 : 0) : cur)
    const mirror = pick('mirrorEnabled', l.mirror_enabled)
    const summary = mirror ? 1 : pick('summaryEnabled', l.summary_enabled) // 等級 2 包含等級 1
    const pushMode = ['off', 'fallback', 'always'].includes(body?.pushMode) ? ['off', 'fallback', 'always'].indexOf(body.pushMode) : pick('pushEnabled', l.push_enabled)
    q.lineSetSettings.run(pushMode, summary, summary ? pick('weeklyEnabled', l.weekly_enabled) : 0, mirror, accountId)
    if (!summary) q.lineSummaryDelete.run(accountId)
    if (!mirror) q.lineMirrorDelete.run(accountId)
    return c.json({ ok: true })
  })
  /** 等級 2：App 端上傳帳本結算鏡像（明文，不含品項與帳號）。 */
  app.post('/api/line/mirror', async (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    const l = q.lineByAccount.get(accountId) as { mirror_enabled: number } | undefined
    if (!l?.mirror_enabled) return c.json({ error: 'mirror_disabled' }, 400)
    const raw = await c.req.text()
    if (raw.length > 1_000_000) return c.json({ error: 'too_large' }, 413)
    let m: Mirror | null = null
    try {
      m = sanitizeMirror(JSON.parse(raw), now())
    } catch {
      /* bad json */
    }
    if (!m) return c.json({ error: 'bad_request' }, 400)
    q.lineMirrorPut.run(accountId, JSON.stringify(m), now())
    return c.json({ ok: true, projects: m.projects.length })
  })
  app.post('/api/line/ack-commands', async (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    const body = await c.req.json().catch(() => null)
    for (const id of Array.isArray(body?.ids) ? body.ids : []) if (Number.isInteger(id)) q.lineCmdAck.run(id, accountId)
    return c.json({ ok: true })
  })
  /** App 端上傳「誰欠我」明文摘要（使用者選擇性開啟）。 */
  app.post('/api/line/summary', async (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    const l = q.lineByAccount.get(accountId) as { summary_enabled: number } | undefined
    if (!l?.summary_enabled) return c.json({ error: 'summary_disabled' }, 400)
    const body = await c.req.json().catch(() => null)
    if (!body || !Array.isArray(body.items)) return c.json({ error: 'bad_request' }, 400)
    const items = (body.items as unknown[]).slice(0, 50).map((it) => {
      const o = it as { name?: unknown; amount?: unknown; currency?: unknown; projects?: unknown }
      return { name: String(o.name ?? '').slice(0, 30), amount: Number(o.amount) || 0, currency: /^[A-Z]{3}$/.test(String(o.currency)) ? String(o.currency) : 'TWD', projects: Array.isArray(o.projects) ? (o.projects as unknown[]).slice(0, 5).map((x) => String(x).slice(0, 30)) : [] }
    }).filter((it) => it.name && it.amount > 0)
    const summary: Summary = { items, total: Math.round(items.reduce((a, it) => a + it.amount, 0) * 100) / 100, currency: /^[A-Z]{3}$/.test(String(body.currency)) ? String(body.currency) : 'TWD', updatedAt: now() }
    q.lineSummaryPut.run(accountId, JSON.stringify(summary), now())
    return c.json({ ok: true, items: items.length })
  })
  app.post('/api/line/ack', async (c) => {
    const accountId = requireAuth(c)
    if (!accountId || accountId === RATE_LIMITED) return authFail(c, accountId)
    const body = await c.req.json().catch(() => null)
    for (const id of Array.isArray(body?.ids) ? body.ids : []) if (Number.isInteger(id)) q.lineDraftAck.run(id, accountId)
    return c.json({ ok: true })
  })
  app.post('/api/line/webhook', async (c) => {
    if (!line?.enabled) return c.json({ error: 'not_found' }, 404)
    const raw = await c.req.text()
    if (!line.verify(raw, c.req.header('x-line-signature'))) return c.json({ error: 'bad_signature' }, 401)
    let body: { events?: LineEvent[] }
    try {
      body = JSON.parse(raw)
    } catch {
      return c.json({ error: 'bad_request' }, 400)
    }
    // 先回 200，事件在背景處理（官方建議）
    for (const ev of body.events ?? []) handleLineEvent(ev).catch((e) => console.error('line event failed', (e as Error).message?.slice(0, 200)))
    return c.json({})
  })

  interface LineEvent {
    type: string
    replyToken?: string
    source?: { type: string; userId?: string; groupId?: string; roomId?: string }
    message?: { type: string; id: string; text?: string; mention?: { mentionees?: { isSelf?: boolean; index: number; length: number }[] } }
    postback?: { data: string }
  }
  const pendingOf = (accountId: string) => (q.lineDraftCount.get(accountId) as { n: number }).n
  const summaryOf = (accountId: string): Summary | null => {
    const row = q.lineSummaryGet.get(accountId) as { payload: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.payload) as Summary
    } catch {
      return null
    }
  }
  const BOT_NAMES = /^\s*@?(?:반반|banban|半半)\s*/i
  const mirrorOf = (accountId: string): Mirror | null => {
    const row = q.lineMirrorGet.get(accountId) as { payload: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.payload) as Mirror
    } catch {
      return null
    }
  }
  const enqueue = (accountId: string, cmd: LineCommand) => {
    q.lineCmdInsert.run(accountId, JSON.stringify(cmd), now())
    return (q.lineCmdLast.get(accountId) as { id: number }).id
  }
  const NEED_L2 = textMsg('這個要開「等級 2：帳本鏡像」才行。到 App 設定頁 → LINE 機器人 打開，bot 才看得到帳本結算（明文，不含品項與帳號）。', quickReply([{ label: '開 App', uri: 'https://spilt.chung.men/#/settings' }]))
  async function handleLineEvent(ev: LineEvent) {
    if (!line) return
    const userId = ev.source?.userId
    const chatId = ev.source?.groupId ?? ev.source?.roomId
    const inGroup = ev.source?.type === 'group' || ev.source?.type === 'room'
    if (ev.type === 'follow' && ev.replyToken) return line.reply(ev.replyToken, [textMsg(LINE_HELP, HELP_QR)])
    if (ev.type === 'join' && ev.replyToken) return line.reply(ev.replyToken, [textMsg('大家好，我是 반반 分帳小幫手 🐥\n在群裡 @반반 加一句話或直接傳「반반 拉麵 900 我付」，我就把它記到你的 App 收件匣。要先私訊我「連結 XXXXXX」綁帳號喔！')])
    if (!ev.replyToken || !userId) return
    const linked = q.lineByUser.get(userId) as { account_id: string; summary_enabled: number; mirror_enabled: number } | undefined
    if (inGroup && chatId) {
      // 記住群裡互動過的人（免費），之後用來對名字
      line.getProfile(userId).then((p) => q.lineMemberSeen.run(chatId, userId, p?.displayName ?? null, now())).catch(() => {})
    }

    if (ev.type === 'postback' && ev.postback) {
      const data = ev.postback.data
      if (data === 'help') return line.reply(ev.replyToken, [textMsg(LINE_HELP, HELP_QR)])
      if (!linked) return line.reply(ev.replyToken, [textMsg('先私訊我「連結 XXXXXX」綁帳號（連結碼在 App 設定頁）。', HELP_QR)])
      if (data === 'inbox') return line.reply(ev.replyToken, [inboxText(pendingOf(linked.account_id), q.lineDraftsPending.all(linked.account_id) as { kind: string; payload: string }[])])
      if (data === 'balances') return line.reply(ev.replyToken, [summaryFlex(linked.summary_enabled ? summaryOf(linked.account_id) : null)])
      const mir = linked.mirror_enabled ? mirrorOf(linked.account_id) : null
      const pb = /^(p|remind|settle|confirm|undo):(.+)$/.exec(data)
      if (pb) {
        if (pb[1] === 'undo') {
          q.lineCmdCancel.run(Number(pb[2]), linked.account_id)
          return line.reply(ev.replyToken, [textMsg('取消了。', HELP_QR)])
        }
        if (!mir) return line.reply(ev.replyToken, [NEED_L2])
        if (pb[1] === 'p') {
          const p = mir.projects.find((x) => x.id === pb[2])
          return line.reply(ev.replyToken, [p ? projectFlex(mir, p) : textMsg('找不到這本帳（可能已刪除）。')])
        }
        if (pb[1] === 'remind') {
          const name = mir.projects.flatMap((p) => p.people).find((x) => x.id === pb[2])?.name
          return line.reply(ev.replyToken, [textMsg(name ? reminderTextFor(mir, pb[2], name) : '找不到這個人。')])
        }
        if (pb[1] === 'settle') {
          const name = mir.projects.flatMap((p) => p.people).find((x) => x.id === pb[2])?.name ?? '他'
          const id = enqueue(linked.account_id, { type: 'settle', personId: pb[2], personName: name })
          return line.reply(ev.replyToken, [textMsg(`已記錄 ${name} 全部還清，App 下次同步會更新。`, quickReply([{ label: '↩️ 取消', data: `undo:${id}` }, { label: '開 App', uri: 'https://spilt.chung.men' }]))])
        }
        if (pb[1] === 'confirm') {
          const [kind, pid] = pb[2].split(':')
          if (kind === 'del') {
            const id = enqueue(linked.account_id, { type: 'deleteProject', projectId: pid })
            return line.reply(ev.replyToken, [textMsg('好，App 下次同步就會刪掉。', quickReply([{ label: '↩️ 取消', data: `undo:${id}` }]))])
          }
        }
      }
      const ack = /^ack:(\d+)$/.exec(data)
      if (ack) {
        q.lineDraftAck.run(Number(ack[1]), linked.account_id)
        return line.reply(ev.replyToken, [textMsg(`已略過。收件匣還有 ${pendingOf(linked.account_id)} 筆。`, HELP_QR)])
      }
      return
    }
    if (ev.type !== 'message' || !ev.message) return
    const m = ev.message

    if (m.type === 'text') {
      let text = (m.text ?? '').trim()
      if (inGroup) {
        // 群組裡只理會 @我 或以「반반」開頭的訊息
        const mentioned = !!m.mention?.mentionees?.some((x) => x.isSelf)
        if (!mentioned && !BOT_NAMES.test(text)) return
        text = text.replace(/@\S+\s*/g, '').replace(BOT_NAMES, '').trim()
        if (!text) return line.reply(ev.replyToken, [textMsg('叫我了嗎？後面接一句話，例如「반반 拉麵 900 我付」，或私訊我傳收據照片。')])
      }
      const code = /^(?:連結|link)\s*([A-Za-z0-9]{6})$/i.exec(text)?.[1]?.toUpperCase()
      if (code) {
        if (inGroup) return line.reply(ev.replyToken, [textMsg('連結碼請私訊我，不要在群裡貼 🙈')])
        const row = q.lineCodeGet.get(code) as { account_id: string; expires_at: number } | undefined
        if (!row || row.expires_at < now()) return line.reply(ev.replyToken, [textMsg('這組連結碼無效或過期了，到 App 設定頁再拿一組（15 分鐘內有效）。')])
        const prof = await line.getProfile(userId)
        q.lineLink.run(userId, row.account_id, prof?.displayName ?? null, now())
        q.lineCodeDelete.run(code, now())
        return line.reply(ev.replyToken, [textMsg(`連結好了，${prof?.displayName ?? '你好'}！以後直接傳收據照片或一句話給我，我幫你變成帳本草稿 ✨\n下面的選單也可以用。`, HELP_QR)])
      }
      if (!linked) return line.reply(ev.replyToken, [textMsg(inGroup ? '你還沒綁帳號，先私訊我「連結 XXXXXX」（連結碼在 App 設定頁）。' : LINE_HELP, HELP_QR)])
      if (/^(help|說明|幫助|\?|？)$/i.test(text)) return line.reply(ev.replyToken, [textMsg(LINE_HELP, HELP_QR)])
      if (/^(收件匣|inbox)$/i.test(text)) return line.reply(ev.replyToken, [inboxText(pendingOf(linked.account_id), q.lineDraftsPending.all(linked.account_id) as { kind: string; payload: string }[])])
      if (/^(誰欠我|餘額|balances?)$/i.test(text)) return line.reply(ev.replyToken, [summaryFlex(linked.summary_enabled ? summaryOf(linked.account_id) : null)])
      if (/^(指令|怎麼用|commands?)$/i.test(text)) return line.reply(ev.replyToken, [textMsg(CMD_HELP, HELP_QR)])
      // 小工具（不需要鏡像）
      const util = await utility(text)
      if (util) return line.reply(ev.replyToken, [util])
      // 等級 2：查詢與指令
      const mir = linked.mirror_enabled ? mirrorOf(linked.account_id) : null
      if (mir) {
        if (/^(最近帳本|最近|帳本|recent)$/i.test(text)) return line.reply(ev.replyToken, [recentFlex(mir)])
        const cmd = parseCommand(mir, text)
        if (cmd) {
          if ('error' in cmd) return line.reply(ev.replyToken, [textMsg(cmd.error, HELP_QR)])
          if (cmd.confirm && cmd.cmd.type === 'deleteProject') return line.reply(ev.replyToken, [textMsg(cmd.reply, quickReply([{ label: '🗑 確定刪除', data: `confirm:del:${cmd.cmd.projectId}` }, { label: '算了', text: '算了' }]))])
          const id = enqueue(linked.account_id, cmd.cmd)
          return line.reply(ev.replyToken, [textMsg(cmd.reply, quickReply([{ label: '↩️ 取消', data: `undo:${id}` }, { label: '開 App', uri: 'https://spilt.chung.men' }]))])
        }
        const remind = /^(?:催|催款)\s*(.+)$/.exec(text)
        if (remind) {
          const f = findPerson(mir, remind[1])
          return line.reply(ev.replyToken, [textMsg(f ? reminderTextFor(mir, f[0], f[1]) : `找不到叫「${remind[1]}」的人。`)])
        }
        if (/^算了$/.test(text)) return line.reply(ev.replyToken, [textMsg('好～', HELP_QR)])
        const trip = findTrip(mir, text)
        if (trip) return line.reply(ev.replyToken, [tripFlex(mir, trip)])
        const proj = findProject(mir, text)
        if (proj && text.length <= 30) return line.reply(ev.replyToken, [projectFlex(mir, proj)])
        const person = findPerson(mir, text)
        if (person && text.length <= 12) return line.reply(ev.replyToken, [personFlex(mir, person[0], person[1])])
      } else if (!inGroup && /^(最近帳本|最近|帳本|recent)$/i.test(text)) return line.reply(ev.replyToken, [NEED_L2])
      if (pendingOf(linked.account_id) >= 50) return line.reply(ev.replyToken, [textMsg('收件匣滿了（50 筆），先到 App 處理一下吧。', HELP_QR)])
      q.lineDraftInsert.run(linked.account_id, 'text', JSON.stringify({ text: text.slice(0, 2000), group: inGroup ? chatId : undefined }), now(), inGroup ? 'group' : 'user')
      const id = (q.lineDraftLast.get(linked.account_id) as { id: number }).id
      return line.reply(ev.replyToken, [textDraftReply(text, id, pendingOf(linked.account_id))])
    }
    if (m.type === 'image') {
      if (inGroup) return // 群裡的圖片不處理（會太吵），私訊才收
      if (!linked) return line.reply(ev.replyToken, [textMsg('先連結帳號我才能幫你存收據喔～\n' + LINE_HELP, HELP_QR)])
      if (pendingOf(linked.account_id) >= 50) return line.reply(ev.replyToken, [textMsg('收件匣滿了（50 筆），先到 App 處理一下吧。', HELP_QR)])
      const img = await line.getContent(m.id)
      if (!img) return line.reply(ev.replyToken, [textMsg('圖片抓不下來，再傳一次試試。')])
      let payload: Record<string, unknown> = { image: img }
      if (ai?.enabled && aiAllowedFor(linked.account_id)) {
        try {
          payload = { receipt: await ai.parse({ image: img }) }
          q.aiBump.run(linked.account_id, dayOf())
        } catch (e) {
          console.error('line receipt parse failed', (e as Error).message?.slice(0, 120))
        }
      }
      q.lineDraftInsert.run(linked.account_id, payload.receipt ? 'receipt' : 'image', JSON.stringify(payload), now(), 'user')
      const id = (q.lineDraftLast.get(linked.account_id) as { id: number }).id
      const n = pendingOf(linked.account_id)
      const receipt = payload.receipt as Parameters<typeof receiptFlex>[0] | undefined
      return line.reply(ev.replyToken, receipt?.items?.length ? [receiptFlex(receipt, id, n)] : [textMsg(`收到收據！已放進收件匣（${n} 筆），到 App 用 AI 辨識後建帳本。`, quickReply([{ label: '去建帳本', uri: 'https://spilt.chung.men/#/inbox' }, { label: '略過', data: `ack:${id}` }]))])
    }
    if (!inGroup) return line.reply(ev.replyToken, [textMsg('目前只吃文字和圖片～', HELP_QR)])
  }

  /** 每週一早上 9 點（台北）推「誰欠我」給有開的人。每小時由 index.ts 呼叫一次。 */
  const runWeekly = async () => {
    if (!line?.enabled) return 0
    const t = new Date(now())
    const taipei = new Date(t.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
    if (taipei.getDay() !== 1 || taipei.getHours() !== 9) return 0
    const due = q.lineWeeklyDue.all(now() - 6 * 86_400_000) as { line_user_id: string; account_id: string; payload: string }[]
    let n = 0
    for (const d of due) {
      try {
        const s = JSON.parse(d.payload) as Summary
        if (s.items.length) {
          const ok = await line.push(d.line_user_id, [textMsg(weeklyText(s))])
          if (ok) n++
        }
        q.lineWeeklyMark.run(now(), d.account_id)
      } catch (e) {
        console.error('weekly push failed', (e as Error).message?.slice(0, 120))
      }
    }
    return n
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
    q.tripPurge.run(now() - inactiveDays * 86_400_000)
    q.lineDraftPurge.run(now() - 30 * 86_400_000)
    q.lineCmdPurge.run(now() - 30 * 86_400_000)
    memes?.purge(7 * 86_400_000)
    return Number(r.changes)
  }
  return { app, purgeExpired, purgeInactive, runWeekly }
}
