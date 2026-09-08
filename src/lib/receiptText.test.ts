import { describe, expect, it } from 'vitest'
import { parseReceiptText } from './receiptText'

describe('parseReceiptText', () => {
  it('parses a convenience-store receipt and finds the total', () => {
    const r = parseReceiptText(`統一超商 台北門市
電話: 02-1234-5678
2026/09/03 12:30
茶葉蛋 x2 20TX
關東煮 45 T
御飯糰 35TX
小計 100
現金 100
找零 0
謝謝光臨`)
    expect(r.rows).toEqual([
      { name: '茶葉蛋', qty: 2, price: 10, raw: '茶葉蛋 x2 20TX' },
      { name: '關東煮', qty: 1, price: 45, raw: '關東煮 45 T' },
      { name: '御飯糰', qty: 1, price: 35, raw: '御飯糰 35TX' },
    ])
    expect(r.total).toBe(100)
    expect(r.date).toBe('2026-09-03')
    expect(r.dropped).toBeGreaterThan(0)
  })
  it('handles Uber Eats style: qty first, price on the next line, fees skipped', () => {
    const r = parseReceiptText(`訂單編號 #A1B2C3
1 x 招牌牛肉麵
$180
2 x 珍珠奶茶
$130
外送費
$29
服務費 $12
小計 $310
總計 $351`)
    expect(r.rows.map((x) => [x.name, x.qty, x.price])).toEqual([
      ['招牌牛肉麵', 1, 180],
      ['珍珠奶茶', 2, 65],
    ])
    expect(r.total).toBe(351)
  })
  it('handles price-first lines, unit price, discounts and bullets', () => {
    const r = parseReceiptText(`- $65 珍珠奶茶
• 雞排 @55 x2 110
折扣 -20
共 3 件
09:41 已送達`)
    expect(r.rows.map((x) => [x.name, x.qty, x.price])).toEqual([
      ['珍珠奶茶', 1, 65],
      ['雞排', 2, 55],
      ['折扣', 1, -20],
    ])
  })
  it('drops phone numbers, ids, separators and header lines', () => {
    const r = parseReceiptText(`==========
AB12345678
0912345678
Table 5
牛排 350`)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].name).toBe('牛排')
  })
})
