import { describe, expect, it } from 'vitest'
import { mergeEInvoice, parseEInvoice } from './einvoice'

// Constructed sample matching the official layout (values are illustrative).
const sales = (280).toString(16).padStart(8, '0')
const total = (300).toString(16).padStart(8, '0')
const left =
  'AB12345678' + '1150903' + '1234' + sales + total + '00000000' + '12345678' + 'x'.repeat(24) +
  ':**********:2:3:1:拉麵:1:180:餃子:1:100'
const right = '**啤酒:1:20'

describe('parseEInvoice', () => {
  it('parses the left QR', () => {
    const r = parseEInvoice(left)
    expect(r?.kind).toBe('left')
    if (r?.kind !== 'left') return
    expect(r.number).toBe('AB12345678')
    expect(r.date).toBe('2026-09-03')
    expect(r.total).toBe(300)
    expect(r.sales).toBe(280)
    expect(r.itemsInQr).toBe(2)
    expect(r.itemsTotal).toBe(3)
    expect(r.items).toEqual([
      { name: '拉麵', qty: 1, price: 180 },
      { name: '餃子', qty: 1, price: 100 },
    ])
  })
  it('parses the right QR and merges', () => {
    const l = parseEInvoice(left)
    const r = parseEInvoice(right)
    expect(r?.kind).toBe('right')
    if (l?.kind !== 'left' || r?.kind !== 'right') return
    const m = mergeEInvoice(l, r)
    expect(m.items.length).toBe(3)
    expect(m.complete).toBe(true)
  })
  it('handles base64 encoded items', () => {
    const b64 = Buffer.from('咖啡:2:60', 'utf8').toString('base64')
    const l = parseEInvoice(
      'CD98765432' + '1150101' + '0000' + sales + total + '00000000' + '87654321' + 'y'.repeat(24) + ':**********:1:1:2:' + b64,
    )
    expect(l?.kind).toBe('left')
    if (l?.kind !== 'left') return
    expect(l.items).toEqual([{ name: '咖啡', qty: 2, price: 60 }])
  })
  it('rejects random text', () => {
    expect(parseEInvoice('hello world')).toBeNull()
  })
})
