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
`

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const raw = new DatabaseSync(file)
  raw.exec('PRAGMA journal_mode = WAL')
  raw.exec('PRAGMA foreign_keys = ON')
  raw.exec('PRAGMA busy_timeout = 3000')
  raw.exec(SCHEMA)
  return { raw, close: () => raw.close() }
}
