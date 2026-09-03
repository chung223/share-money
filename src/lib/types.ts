export type Id = string

export interface Person {
  id: Id
  name: string
  emoji: string
  color: string // one of the palette keys, e.g. 'pink'
}

export type SplitMode = 'equal' | 'items' | 'mains'

export interface Item {
  id: Id
  name: string
  price: number // unit price in project currency
  qty: number
  /** 'all' = everyone in the project shares it; otherwise explicit person ids. */
  sharedBy: 'all' | Id[]
  /** Used by the "mains" mode UI: main dish (one person) vs shared side. */
  kind: 'main' | 'shared'
}

export type ExtraType = 'percent' | 'fixed'
export type ExtraSplit = 'proportional' | 'equal'

export interface Extra {
  id: Id
  name: string
  emoji: string
  type: ExtraType
  value: number // percent (10 = 10%) or fixed amount in project currency; negative = discount
  split: ExtraSplit
}

export interface Payment {
  personId: Id
  amount: number
}

export interface Project {
  id: Id
  name: string
  emoji: string
  date: string // YYYY-MM-DD
  createdAt: number
  updatedAt: number
  currency: string // e.g. 'JPY'
  /** 1 unit of `currency` = `rate` units of base currency. null when currency === base. */
  rate: number | null
  rateDate?: string
  rateSource?: 'api' | 'manual'
  mode: SplitMode
  /** Primary payer. When `payments` is empty this person paid everything (classic single-payer). */
  payerId: Id
  /**
   * Multi-payer: who actually paid how much (project currency). Sum should equal the grand total.
   * Empty/absent = single payer (`payerId`). Settlement then becomes a set of transfers (see split.ts).
   */
  payments?: Payment[]
  people: Person[]
  items: Item[]
  extras: Extra[]
  /**
   * Which transfers are done. Keyed by transfer key `${from}_${to}` (see split.ts transferKey).
   * Legacy single-payer data keyed by personId is still understood.
   */
  settled: Record<string, boolean>
  /** Partial repayments per transfer key, in the transfer's due currency (see split.ts Transfer). */
  partial?: Record<string, number>
  /** Notes friends attached when tapping「我轉了」on the share page (e.g. LINE Pay, 末五碼), per transfer key. */
  paidNotes?: Record<string, string>
  /** Round each person's amount up to a multiple of 5 / 10 (single-payer only). 0/undefined = off. */
  rounding?: 0 | 5 | 10
  note?: string
  /** Friend-facing share link (see lib/share.ts). Snapshot is re-uploaded on sync when stale. */
  share?: ProjectShare
}

export interface ProjectShare {
  id: string
  /** base64url AES-GCM key; lives only in the URL fragment and in the owner's (encrypted) data. */
  key: string
  expiresAt: number
  /** project.updatedAt at the time the snapshot was uploaded; older than updatedAt = needs re-upload. */
  uploadedAt: number
}

/** How friends can pay you back. Shown on the share page and in reminder messages. */
export interface PayInfo {
  bankCode?: string
  bankName?: string
  account?: string
  linePay?: string
  note?: string
}

/** Multi-device sync (end-to-end encrypted; see lib/sync.ts). */
export interface SyncConfig {
  /** bb1.<base64url 32 bytes>: everything is derived from this. Never sent to the server as-is. */
  secret: string
  /** '' = same origin as the app. */
  serverUrl: string
  enabledAt: number
}

/** A saved combination of friends + default split mode, for one-tap new projects. */
export interface Group {
  id: Id
  name: string
  emoji: string
  personIds: Id[]
  mode: SplitMode
}

export interface AppData {
  version: 1
  me: Person
  friends: Person[]
  groups?: Group[]
  projects: Project[]
  baseCurrency: string
  payInfo?: PayInfo
  sync?: SyncConfig
  /** Tombstones: projectId -> deletion time, so a delete wins over a stale copy on another device. */
  deleted?: Record<Id, number>
  /** Bumped on every change; used to pick the newer side for scalar fields when merging. */
  updatedAt?: number
}

export const PALETTE = ['pink', 'mint', 'lavender', 'butter', 'sky', 'peach', 'lime', 'grape'] as const
export type PaletteColor = (typeof PALETTE)[number]

export const PERSON_EMOJIS = ['🐥', '🐰', '🐻', '🐱', '🐶', '🐼', '🦊', '🐨', '🐸', '🐧', '🦄', '🐯', '🐷', '🐹', '🦁', '🐮', '🍓', '🍑', '🍋', '🥑', '🌸', '⭐', '🍙', '🧸']
export const PROJECT_EMOJIS = ['🍜', '🍕', '🍣', '🍔', '🍰', '☕', '🧋', '🍺', '🍱', '🥘', '🍗', '🌮', '🥟', '🍦', '🚕', '🛵', '🎬', '🎤', '🏨', '✈️', '🛒', '🎁', '🎳', '🧧']

export const CURRENCIES: { code: string; name: string; flag: string; decimals: number }[] = [
  { code: 'TWD', name: '新台幣', flag: '🇹🇼', decimals: 0 },
  { code: 'JPY', name: '日圓', flag: '🇯🇵', decimals: 0 },
  { code: 'KRW', name: '韓元', flag: '🇰🇷', decimals: 0 },
  { code: 'USD', name: '美元', flag: '🇺🇸', decimals: 2 },
  { code: 'EUR', name: '歐元', flag: '🇪🇺', decimals: 2 },
  { code: 'GBP', name: '英鎊', flag: '🇬🇧', decimals: 2 },
  { code: 'HKD', name: '港幣', flag: '🇭🇰', decimals: 2 },
  { code: 'CNY', name: '人民幣', flag: '🇨🇳', decimals: 2 },
  { code: 'THB', name: '泰銖', flag: '🇹🇭', decimals: 2 },
  { code: 'SGD', name: '新加坡幣', flag: '🇸🇬', decimals: 2 },
  { code: 'MYR', name: '馬來西亞令吉', flag: '🇲🇾', decimals: 2 },
  { code: 'VND', name: '越南盾', flag: '🇻🇳', decimals: 0 },
  { code: 'PHP', name: '菲律賓披索', flag: '🇵🇭', decimals: 2 },
  { code: 'IDR', name: '印尼盾', flag: '🇮🇩', decimals: 0 },
  { code: 'AUD', name: '澳幣', flag: '🇦🇺', decimals: 2 },
  { code: 'CAD', name: '加幣', flag: '🇨🇦', decimals: 2 },
  { code: 'CHF', name: '瑞士法郎', flag: '🇨🇭', decimals: 2 },
  { code: 'NZD', name: '紐幣', flag: '🇳🇿', decimals: 2 },
]

export function currencyMeta(code: string) {
  return CURRENCIES.find((c) => c.code === code) ?? { code, name: code, flag: '💱', decimals: 2 }
}
