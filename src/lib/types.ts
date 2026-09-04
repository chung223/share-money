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

/** 旅程：把一趟出遊的多本帳（各自分類）包在一起，跨本結算、共編。 */
export interface Trip {
  id: Id
  name: string
  emoji: string
  createdAt: number
  updatedAt: number
  note?: string
  /** 共編（第二階段）：連結裡的金鑰、伺服器版本等 */
  share?: TripShare
}
export interface TripShare {
  id: string
  /** base64url 32 bytes；派生 auth token 與加密金鑰 */
  secret: string
  role: 'owner' | 'member'
  /** 已知的伺服器版本 */
  version: number
  /** 上次成功推送時的本地內容指紋（避免重複推） */
  pushedHash?: string
  /** 成員在這趟裡對應的 person id（成員自己的 me.id 與旅程內的人不同） */
  myPersonId?: Id
  joinedAt: number
}

export interface Project {
  id: Id
  name: string
  emoji: string
  /** 屬於哪趟旅程（可無） */
  tripId?: Id
  /** 吃飯 / 交通 / 購物 / 旅遊 / 娛樂 / 其他；缺省時由 emoji 推測（見 lib/category.ts）。 */
  category?: 'food' | 'transport' | 'shopping' | 'travel' | 'fun' | 'other'
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
  /** Plaintext title for LINE/FB link previews (the only unencrypted thing about a share). null = hidden. */
  ogTitle?: string | null
}

/** How friends can pay you back. Shown on the share page and in reminder messages. */
export interface PayInfo {
  bankCode?: string
  bankName?: string
  account?: string
  linePay?: string
  note?: string
  /** 分享頁要顯示哪些行動支付快捷按鈕（見 lib/twqr.ts）。未設定 = LINE Pay + 街口。 */
  quickPay?: ('linepay' | 'jkopay' | 'twpay' | 'pxpay')[]
  /** 分享頁顯示 TWQR 轉帳 QR（需要銀行代碼＋帳號）。預設開。 */
  showTwqr?: boolean
  /** 自訂轉帳 App 連結範本（見 lib/twqr.ts buildAppUrl），例：mybank://transfer?acct={account}&amt={amount} */
  appLinks?: { id: string; label: string; template: string }[]
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
  trips?: Trip[]
  /** 給某個人的跨帳本連結（personId → share）。快照在同步時若有帳本更新會自動重傳。 */
  personShares?: Record<Id, ProjectShare>
  projects: Project[]
  baseCurrency: string
  payInfo?: PayInfo
  /** 使用者自帶的 AI（BYOK）。金鑰存在這裡 = 有 PIN 就跟著加密、同步時端對端加密。 */
  aiProvider?: { format: 'openai' | 'anthropic'; baseUrl: string; model: string; apiKey: string; preset?: string }
  sync?: SyncConfig
  /** Tombstones: projectId (or `trip:<id>`) -> deletion time, so a delete wins over a stale copy on another device. */
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
