/** 帳本分類：文案、預設圖示、分法名稱都跟著分類走，不再假設每本都是吃飯。 */
import type { Project, SplitMode } from './types'

export type Category = 'food' | 'transport' | 'shopping' | 'travel' | 'fun' | 'other'

export interface CategoryMeta {
  id: Category
  emoji: string
  label: string
  emojis: string[]
  /** 「這餐」「這趟」… */
  thisOne: string
  unnamed: string
  namePlaceholder: string
  equalHint: string
  /** mains 模式：個人項目 / 共用項目的叫法 */
  mainLabel: string
  sharedLabel: string
  mainsMode: string
  mainsDesc: string
  itemsDesc: string
}

export const CATEGORIES: CategoryMeta[] = [
  { id: 'food', emoji: '🍽️', label: '吃飯', emojis: ['🍜', '🍕', '🍣', '🍔', '🍰', '☕', '🧋', '🍺', '🍱', '🥘', '🍗', '🌮', '🥟', '🍦', '🍲', '🍻'], thisOne: '這餐', unnamed: '未命名聚餐', namePlaceholder: '這餐叫什麼？', equalHint: '輸入這餐的總金額就好。', mainLabel: '🍛 主餐', sharedLabel: '🥗 共享', mainsMode: '主餐+共享', mainsDesc: '主餐各付各的，小菜大家分', itemsDesc: '每個品項點誰吃，多人就均分' },
  { id: 'transport', emoji: '🚕', label: '交通', emojis: ['🚕', '🛵', '🚗', '🚌', '🚄', '⛽', '🅿️', '🛣️'], thisOne: '這趟', unnamed: '未命名車資', namePlaceholder: '去哪裡？例：機場計程車', equalHint: '輸入這趟的總車資就好。', mainLabel: '🎫 個人', sharedLabel: '🚕 共乘', mainsMode: '個人+共乘', mainsDesc: '自己的票自己付，共乘的大家分', itemsDesc: '每段路點誰搭，多人就均分' },
  { id: 'shopping', emoji: '🛒', label: '購物', emojis: ['🛒', '🎁', '🛍️', '📦', '🧴', '👕', '💊', '🧻', '🍎'], thisOne: '這單', unnamed: '未命名採買', namePlaceholder: '買了什麼？例：Costco 團購', equalHint: '輸入這單的總金額就好。', mainLabel: '🏷️ 自己的', sharedLabel: '🛒 共用', mainsMode: '自己的+共用', mainsDesc: '自己買的自己付，共用的大家分', itemsDesc: '每樣東西點誰要，多人就均分' },
  { id: 'travel', emoji: '✈️', label: '旅遊', emojis: ['✈️', '🏨', '🗼', '⛺', '🎢', '🏖️', '🚢', '🗺️', '🎿'], thisOne: '這趟', unnamed: '未命名旅程', namePlaceholder: '去哪玩？例：沖繩三天', equalHint: '輸入這趟的總花費就好。', mainLabel: '🎫 個人', sharedLabel: '🏨 共同', mainsMode: '個人+共同', mainsDesc: '機票各付各的，住宿租車大家分', itemsDesc: '每筆花費點誰參加，多人就均分' },
  { id: 'fun', emoji: '🎉', label: '娛樂', emojis: ['🎉', '🎬', '🎤', '🎳', '🎮', '🎭', '⚽', '🎡', '🧧'], thisOne: '這次', unnamed: '未命名活動', namePlaceholder: '玩什麼？例：KTV 夜唱', equalHint: '輸入這次的總金額就好。', mainLabel: '🎫 個人', sharedLabel: '🎉 共享', mainsMode: '個人+共享', mainsDesc: '自己的自己付，共用的大家分', itemsDesc: '每項點誰參加，多人就均分' },
  { id: 'other', emoji: '📦', label: '其他', emojis: ['📦', '💡', '🏠', '🐶', '💐', '🧾', '💰', '🔧'], thisOne: '這次', unnamed: '未命名帳本', namePlaceholder: '這是什麼？例：房租水電', equalHint: '輸入總金額就好。', mainLabel: '🏷️ 個人', sharedLabel: '📦 共用', mainsMode: '個人+共用', mainsDesc: '自己的自己付，共用的大家分', itemsDesc: '每項點誰要，多人就均分' },
]

const byId = new Map(CATEGORIES.map((c) => [c.id, c]))
const byEmoji = new Map<string, Category>()
for (const c of CATEGORIES) for (const e of c.emojis) if (!byEmoji.has(e)) byEmoji.set(e, c.id)

/** Explicit category, else guessed from the emoji (old projects), else food. */
export function categoryOf(p: Pick<Project, 'category' | 'emoji'>): CategoryMeta {
  const id = p.category ?? byEmoji.get(p.emoji) ?? 'food'
  return byId.get(id) ?? CATEGORIES[0]
}

export function modeLabel(mode: SplitMode, cat: CategoryMeta) {
  return mode === 'equal' ? '均攤' : mode === 'items' ? '各點各的' : cat.mainsMode
}

/** Emoji picker order: the current category first, then everything else. */
export function emojiOptions(cat: CategoryMeta) {
  const rest = CATEGORIES.filter((c) => c.id !== cat.id).flatMap((c) => c.emojis)
  return [...new Set([...cat.emojis, ...rest])]
}
