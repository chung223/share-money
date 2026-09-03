/**
 * 站方 AI（MiniMax）：用共用的 receiptAi 呼叫；只有設定 MINIMAX_API_KEY 才啟用。
 * 使用者自帶金鑰（BYOK）走 app.ts 的 /api/parse/byok，同樣用 callProvider，金鑰只在該次請求記憶體裡。
 */
import { callProvider, type ParseInput, type ParseOutput } from '../../src/lib/receiptAi.ts'
export { normalise, firstJsonObject, type ParseOutput } from '../../src/lib/receiptAi.ts'

export interface AiParser {
  enabled: boolean
  parse(input: ParseInput): Promise<ParseOutput>
}

export function createAiParser(opts: { apiKey?: string; baseUrl?: string; model?: string; visionModel?: string; fetchFn?: typeof fetch }): AiParser {
  const { apiKey, baseUrl = 'https://api.minimaxi.com/v1', model = 'MiniMax-M2.5', visionModel = 'MiniMax-M3', fetchFn = fetch } = opts
  if (!apiKey) return { enabled: false, parse: async () => ({ items: [], total: null, date: null, currency: null, extras: [], merchant: null }) }
  return {
    enabled: true,
    parse: (input) => callProvider({ format: 'openai', baseUrl, model: input.image ? visionModel : model, apiKey }, input, { fetchFn }),
  }
}
