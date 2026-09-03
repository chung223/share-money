/**
 * Historical exchange rates via the free, key-less currency-api
 * (https://github.com/fawazahmed0/exchange-api). Only the currency code and date
 * leave the device; amounts never do.
 */
export interface RateResult {
  rate: number // 1 from = rate to
  date: string // date the rate is for
  requestedDate: string
}

function urls(date: string, from: string) {
  const f = from.toLowerCase()
  return [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${f}.min.json`,
    `https://${date}.currency-api.pages.dev/v1/currencies/${f}.min.json`,
  ]
}

async function fetchJson(url: string, timeoutMs = 8000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

export async function fetchRate(from: string, to: string, date: string): Promise<RateResult> {
  const today = new Date().toISOString().slice(0, 10)
  const candidates: string[] = []
  // Try exact date, then walk back a few days (weekends/holidays), then latest.
  const d = new Date(date + 'T00:00:00Z')
  const isFuture = date > today
  if (!isFuture && !Number.isNaN(d.getTime())) {
    for (let i = 0; i < 4; i++) {
      const dd = new Date(d.getTime() - i * 86400000).toISOString().slice(0, 10)
      candidates.push(dd)
    }
  }
  candidates.push('latest')
  let lastErr: unknown = null
  for (const day of candidates) {
    for (const url of urls(day, from)) {
      try {
        const json = await fetchJson(url)
        const table = json[from.toLowerCase()]
        const rate = table?.[to.toLowerCase()]
        if (typeof rate === 'number' && rate > 0) {
          return { rate, date: json.date ?? day, requestedDate: date }
        }
        throw new Error('rate missing')
      } catch (e) {
        lastErr = e
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('無法取得匯率')
}
