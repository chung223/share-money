import { describe, expect, it } from 'vitest'
import { twqrTransfer } from './twqr'

describe('twqrTransfer', () => {
  it('encodes bank, account and amount in cents', () => {
    expect(twqrTransfer({ bankCode: '808', account: '1234-5678-9012', amount: 250, name: '小賴' })).toBe('TWQRP://%E5%B0%8F%E8%B3%B4/158/02/V1?D1=25000&D5=808&D6=123456789012&D10=901')
    expect(twqrTransfer({ bankCode: '004', account: '123456', amount: 12.5 })).toContain('D1=1250&D5=004&D6=123456')
  })
  it('rejects bad input', () => {
    expect(twqrTransfer({ bankCode: '80', account: '123456', amount: 1 })).toBeNull()
    expect(twqrTransfer({ bankCode: '808', account: '123', amount: 1 })).toBeNull()
    expect(twqrTransfer({ bankCode: '808', account: '123456', amount: 0 })).toBeNull()
  })
})
