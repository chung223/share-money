import { describe, expect, it } from 'vitest'
import { parseReceiptText } from './receiptText'

describe('parseReceiptText', () => {
  it('extracts items and total from a typical receipt', () => {
    const txt = `
      好吃拉麵店
      日期: 2026/09/03 12:31
      味噌拉麵          180
      煎餃 x2           120
      可樂              30 TX
      小計              330
      總計              330
      現金              500
      找零              170
    `
    const r = parseReceiptText(txt)
    expect(r.date).toBe('2026-09-03')
    expect(r.total).toBe(330)
    expect(r.rows.map((x) => [x.name, x.qty, x.price])).toEqual([
      ['味噌拉麵', 1, 180],
      ['煎餃', 2, 60],
      ['可樂', 1, 30],
    ])
  })
  it('handles decimals and thousands separators', () => {
    const r = parseReceiptText('Sushi set $1,280.50\nGreen tea 3.00\nTOTAL 1283.50')
    expect(r.rows[0]).toMatchObject({ name: 'Sushi set', price: 1280.5 })
    expect(r.rows[1]).toMatchObject({ name: 'Green tea', price: 3 })
    expect(r.total).toBe(1283.5)
  })
})
