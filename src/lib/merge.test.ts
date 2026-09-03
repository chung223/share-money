import { describe, expect, it } from 'vitest'
import { mergeResults, type ImportResult } from '../components/ImportSheet'

describe('mergeResults', () => {
  const a: ImportResult = { rows: [{ name: 'a', qty: 1, price: 10 }], total: 10, date: '2026-09-01', source: 'ai', extras: [{ name: '外送費', amount: 5 }], currency: 'TWD', dropped: 1 }
  const b: ImportResult = { rows: [{ name: 'b', qty: 2, price: 3 }], total: 6, date: null, source: 'ocr', dropped: 2 }
  it('concatenates rows/extras, sums totals only when all present, keeps first date', () => {
    const m = mergeResults([a, b])
    expect(m.rows.map((r) => r.name)).toEqual(['a', 'b'])
    expect(m.total).toBe(16)
    expect(m.date).toBe('2026-09-01')
    expect(m.extras).toEqual([{ name: '外送費', amount: 5 }])
    expect(m.dropped).toBe(3)
    expect(m.files).toBe(2)
    expect(mergeResults([a, { ...b, total: null }]).total).toBeNull()
    expect(mergeResults([a])).toBe(a)
  })
})
