import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Db {
  raw: DatabaseSync
  close(): void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS blobs (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  cipher TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  cipher TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, project_id)
);
CREATE TABLE IF NOT EXISTS share_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  acked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS share_events_share ON share_events(share_id, acked);
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_account ON push_subs(account_id);
CREATE TABLE IF NOT EXISTS account_flags (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  ai_allowed INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  cipher TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS line_links (
  line_user_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  display_name TEXT,
  push_enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS line_links_account ON line_links(account_id);
CREATE TABLE IF NOT EXISTS line_link_codes (
  code TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS line_summaries (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS line_mirrors (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS line_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS line_commands_account ON line_commands(account_id, consumed);
CREATE TABLE IF NOT EXISTS line_group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS line_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS line_drafts_account ON line_drafts(account_id, consumed);
CREATE TABLE IF NOT EXISTS ai_usage (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day)
);
`

/** Columns added after the first release; ALTER is idempotent via PRAGMA check. */
const MIGRATIONS: [table: string, column: string, ddl: string][] = [
  ['share_events', 'note', 'ALTER TABLE share_events ADD COLUMN note TEXT'],
  ['share_events', 'label', 'ALTER TABLE share_events ADD COLUMN label TEXT'],
  ['shares', 'og_title', 'ALTER TABLE shares ADD COLUMN og_title TEXT'],
  ['line_links', 'summary_enabled', 'ALTER TABLE line_links ADD COLUMN summary_enabled INTEGER NOT NULL DEFAULT 0'],
  ['line_links', 'weekly_enabled', 'ALTER TABLE line_links ADD COLUMN weekly_enabled INTEGER NOT NULL DEFAULT 0'],
  ['line_links', 'last_weekly_at', 'ALTER TABLE line_links ADD COLUMN last_weekly_at INTEGER NOT NULL DEFAULT 0'],
  ['line_drafts', 'origin', 'ALTER TABLE line_drafts ADD COLUMN origin TEXT'],
  ['share_events', 'project_id', 'ALTER TABLE share_events ADD COLUMN project_id TEXT'],
  ['line_links', 'mirror_enabled', 'ALTER TABLE line_links ADD COLUMN mirror_enabled INTEGER NOT NULL DEFAULT 0'],
]

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const raw = new DatabaseSync(file)
  raw.exec('PRAGMA journal_mode = WAL')
  raw.exec('PRAGMA foreign_keys = ON')
  raw.exec('PRAGMA busy_timeout = 3000')
  raw.exec(SCHEMA)
  for (const [table, column, ddl] of MIGRATIONS) {
    const cols = raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!cols.some((c) => c.name === column)) raw.exec(ddl)
  }
  return { raw, close: () => raw.close() }
}
