/**
 * 收據辨識的 AI 呼叫（前後端共用、零依賴）：
 * - 'openai' 格式：/chat/completions（OpenAI、Gemini OpenAI 相容端點、OpenRouter、Groq、MiniMax、自架 vLLM/Ollama…）
 * - 'anthropic' 格式：/messages
 * 只負責組請求、打 fetch、把模型輸出正規化成 ParseOutput；金鑰怎麼存由呼叫端決定。
 */
export type AiFormat = 'openai' | 'anthropic'

export interface AiProviderConfig {
  format: AiFormat
  baseUrl: string
  model: string
  apiKey: string
}
export interface ParseInput {
  text?: string
  image?: { mediaType: string; base64: string }
}
export interface ParsedItem {
  name: string
  qty: number
  price: number
}
export interface ParseOutput {
  items: ParsedItem[]
  total: number | null
  date: string | null
  currency: string | null
  extras: { name: string; amount: number }[]
  merchant: string | null
}

export const RECEIPT_SYSTEM = `你是收據解析器。使用者會給你一張收據／訂單截圖或文字，請只輸出一個 JSON 物件，不要任何其他文字：
{"items":[{"name":"品名","qty":數量,"price":單價}],"extras":[{"name":"服務費/外送費/折扣等","amount":金額}],"total":總計或null,"date":"YYYY-MM-DD"或null,"currency":"TWD"等ISO代碼或null,"merchant":"店名"或null}
規則：
- items 只放實際購買的品項，去掉小計、稅、找零、現金、卡號、發票號碼、電話、地址等雜訊。
- price 是「單價」；如果收據只給該行總額，請除以數量。
- 折扣放在 extras，amount 為負數。外送費、服務費、平台費放 extras，amount 為正。
- 品名保留原文語言，去掉前面的編號和多餘符號。
- 不確定的數字寧可 null，不要亂猜。`

export const AI_PRESETS: { id: string; label: string; format: AiFormat; baseUrl: string; model: string; hint?: string }[] = [
  { id: 'openai', label: 'OpenAI', format: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  { id: 'anthropic', label: 'Anthropic', format: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5-20251001' },
  { id: 'gemini', label: 'Google Gemini', format: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { id: 'openrouter', label: 'OpenRouter', format: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash' },
  { id: 'groq', label: 'Groq', format: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  { id: 'minimax', label: 'MiniMax', format: 'openai', baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3' },
  { id: 'custom', label: '自訂（OpenAI 相容）', format: 'openai', baseUrl: '', model: '', hint: 'Ollama、vLLM、LM Studio 等' },
]

function trimBase(u: string) {
  return u.trim().replace(/\/+$/, '')
}

export interface ChatInput {
  system: string
  user: string
  image?: { mediaType: string; base64: string }
  maxTokens?: number
  temperature?: number
}

/** 組出 fetch 的 URL / headers / body（任意 system/user）。抽出來方便測試，也讓瀏覽器與伺服器用同一份。 */
export function buildChatRequest(cfg: AiProviderConfig, input: ChatInput, opts: { browser?: boolean } = {}): { url: string; init: RequestInit } {
  const userText = input.user
  const maxTokens = input.maxTokens ?? 2000
  const temperature = input.temperature ?? 0.1
  if (cfg.format === 'anthropic') {
    const content: unknown[] = []
    if (input.image) content.push({ type: 'image', source: { type: 'base64', media_type: input.image.mediaType, data: input.image.base64 } })
    content.push({ type: 'text', text: userText })
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }
    if (opts.browser) headers['anthropic-dangerous-direct-browser-access'] = 'true'
    return {
      url: `${trimBase(cfg.baseUrl) || 'https://api.anthropic.com/v1'}/messages`,
      init: { method: 'POST', headers, body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, temperature, system: input.system, messages: [{ role: 'user', content }] }) },
    }
  }
  const content: unknown[] = []
  if (input.image) content.push({ type: 'image_url', image_url: { url: `data:${input.image.mediaType};base64,${input.image.base64}` } })
  content.push({ type: 'text', text: userText })
  return {
    url: `${trimBase(cfg.baseUrl)}/chat/completions`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: input.system }, { role: 'user', content }], temperature, max_tokens: maxTokens }),
    },
  }
}

/** 收據解析專用的請求。 */
export function buildRequest(cfg: AiProviderConfig, input: ParseInput, opts: { browser?: boolean } = {}) {
  return buildChatRequest(cfg, { system: RECEIPT_SYSTEM, user: input.text ? `收據內容：\n${input.text}` : '請解析這張收據。', image: input.image }, opts)
}

/** 任意對話：回傳模型文字（已去掉 <think>）。 */
export async function callChat(cfg: AiProviderConfig, input: ChatInput, opts: { browser?: boolean; fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<string> {
  const fetchFn = opts.fetchFn ?? fetch
  const { url, init } = buildChatRequest(cfg, input, opts)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 60_000)
  try {
    const r = await fetchFn(url, { ...init, signal: ctl.signal })
    const bodyText = await r.text()
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${bodyText.slice(0, 200)}`)
    let j: unknown
    try {
      j = JSON.parse(bodyText)
    } catch {
      throw new Error('回應不是 JSON：' + bodyText.slice(0, 120))
    }
    return extractText(cfg.format, j).replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  } finally {
    clearTimeout(timer)
  }
}

/** 從兩種回應格式取出文字。 */
export function extractText(format: AiFormat, j: unknown): string {
  const o = j as { choices?: { message?: { content?: string | { type: string; text?: string }[] } }[]; content?: { type: string; text?: string }[]; base_resp?: { status_code?: number; status_msg?: string }; error?: { message?: string } }
  if (o.error?.message) throw new Error(o.error.message)
  if (o.base_resp?.status_code) throw new Error(`${o.base_resp.status_code}: ${o.base_resp.status_msg}`)
  if (format === 'anthropic') return (o.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
  const c = o.choices?.[0]?.message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((x) => x.text ?? '').join('')
  return ''
}

export async function callProvider(cfg: AiProviderConfig, input: ParseInput, opts: { browser?: boolean; fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<ParseOutput> {
  const fetchFn = opts.fetchFn ?? fetch
  const { url, init } = buildRequest(cfg, input, opts)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 60_000)
  try {
    const r = await fetchFn(url, { ...init, signal: ctl.signal })
    const bodyText = await r.text()
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${bodyText.slice(0, 200)}`)
    let j: unknown
    try {
      j = JSON.parse(bodyText)
    } catch {
      throw new Error('回應不是 JSON：' + bodyText.slice(0, 120))
    }
    return normalise(extractText(cfg.format, j))
  } finally {
    clearTimeout(timer)
  }
}

/** 取出第一個大括號平衡的 JSON 物件（模型偶爾會在後面再補說明或第二個物件）。 */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function normalise(raw: string): ParseOutput {
  // M2/M3、部分模型會先吐 <think>…</think>，再給答案；也可能包在 ```json 裡
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '')
  const jsonText = firstJsonObject(text)
  if (!jsonText) throw new Error('模型沒有回傳 JSON')
  const j = JSON.parse(jsonText) as Partial<ParseOutput>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)
  const items = (Array.isArray(j.items) ? j.items : [])
    .map((it) => ({ name: String(it?.name ?? '').trim().slice(0, 60), qty: Math.max(1, Math.min(999, Math.round(num(it?.qty) ?? 1))), price: num(it?.price) ?? 0 }))
    .filter((it) => it.name && it.price !== 0)
    .slice(0, 100)
  const extras = (Array.isArray(j.extras) ? j.extras : [])
    .map((e) => ({ name: String(e?.name ?? '').trim().slice(0, 40), amount: num(e?.amount) ?? 0 }))
    .filter((e) => e.name && e.amount !== 0)
    .slice(0, 10)
  const date = typeof j.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : null
  const currency = typeof j.currency === 'string' && /^[A-Z]{3}$/.test(j.currency) ? j.currency : null
  return { items, extras, total: num(j.total), date, currency, merchant: typeof j.merchant === 'string' ? j.merchant.slice(0, 60) : null }
}

/** 代轉時擋掉內網位址（SSRF）。 */
export function isPublicHttpsUrl(u: string): boolean {
  let url: URL
  try {
    url = new URL(u)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const h = url.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 100 && b >= 64 && b <= 127) return false
  }
  if (h.startsWith('[') || h.includes(':')) return false // 不代轉 IPv6 字面值
  return true
}
