/**
 * 收據解析：把文字或圖片丟給 MiniMax（OpenAI 相容 chat/completions），回傳結構化品項。
 * 只有設定 MINIMAX_API_KEY 才啟用；每個帳號每天有次數上限。圖片不落地。
 * 文字用 MINIMAX_MODEL（M2.5），圖片用 MINIMAX_VISION_MODEL（M3 可吃 image_url）。
 */
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
  /** 建議的額外費用（服務費、外送費、折扣），不進品項 */
  extras: { name: string; amount: number }[]
  merchant: string | null
}

const SYSTEM = `你是收據解析器。使用者會給你一張收據／訂單截圖或文字，請只輸出一個 JSON 物件，不要任何其他文字：
{"items":[{"name":"品名","qty":數量,"price":單價}],"extras":[{"name":"服務費/外送費/折扣等","amount":金額}],"total":總計或null,"date":"YYYY-MM-DD"或null,"currency":"TWD"等ISO代碼或null,"merchant":"店名"或null}
規則：
- items 只放實際購買的品項，去掉小計、稅、找零、現金、卡號、發票號碼、電話、地址等雜訊。
- price 是「單價」；如果收據只給該行總額，請除以數量。
- 折扣放在 extras，amount 為負數。外送費、服務費、平台費放 extras，amount 為正。
- 品名保留原文語言，去掉前面的編號和多餘符號。
- 不確定的數字寧可 null，不要亂猜。`

export interface AiParser {
  enabled: boolean
  parse(input: { text?: string; image?: { mediaType: string; base64: string } }): Promise<ParseOutput>
}

export function createAiParser(opts: { apiKey?: string; baseUrl?: string; model?: string; visionModel?: string; fetchFn?: typeof fetch }): AiParser {
  const { apiKey, baseUrl = 'https://api.minimaxi.com/v1', model = 'MiniMax-M2.5', visionModel = 'MiniMax-M3', fetchFn = fetch } = opts
  if (!apiKey) return { enabled: false, parse: async () => ({ items: [], total: null, date: null, currency: null, extras: [], merchant: null }) }
  return {
    enabled: true,
    async parse(input) {
      const content: unknown[] = []
      if (input.image) content.push({ type: 'image_url', image_url: { url: `data:${input.image.mediaType};base64,${input.image.base64}`, detail: 'default' } })
      content.push({ type: 'text', text: input.text ? `收據內容：\n${input.text}` : '請解析這張收據。' })
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 60_000)
      try {
        const r = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: input.image ? visionModel : model,
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user', content },
            ],
            temperature: 0.1,
            max_completion_tokens: 2000,
          }),
          signal: ctl.signal,
        })
        if (!r.ok) throw new Error(`minimax ${r.status}: ${(await r.text()).slice(0, 200)}`)
        const j = (await r.json()) as { choices?: { message?: { content?: string } }[]; base_resp?: { status_code?: number; status_msg?: string } }
        if (j.base_resp?.status_code) throw new Error(`minimax ${j.base_resp.status_code}: ${j.base_resp.status_msg}`)
        const text = j.choices?.[0]?.message?.content ?? ''
        return normalise(text)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export function normalise(raw: string): ParseOutput {
  // M2/M3 會先吐 <think>…</think>，再給答案；也可能包在 ```json 裡
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '')
  const jsonText = firstJsonObject(text)
  if (!jsonText) throw new Error('no json in model output')
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
