import { describe, expect, it } from 'vitest'
import { twqrTransfer } from './twqr'

describe('twqrTransfer', () => {
  it('matches the Cathay CUBE payload shape: whole string percent-encoded, 16-digit account, amount in dollars', () => {
    const out = twqrTransfer({ bankCode: '013', account: '699500327859', amount: 250 })!
    expect(decodeURIComponent(out)).toBe('TWQRP://個人轉帳/158/02/V1?D1=250&D5=013&D6=0000699500327859&D10=901')
    expect(out.startsWith('TWQRP%3A%2F%2F%E5%80%8B%E4%BA%BA%E8%BD%89%E5%B8%B3%2F158%2F02%2FV1%3F')).toBe(true)
    expect(decodeURIComponent(twqrTransfer({ bankCode: '004', account: '1234-5678', amount: 12.5 })!)).toContain('D1=13&D5=004&D6=0000000012345678')
  })
  it('rejects bad input', () => {
    expect(twqrTransfer({ bankCode: '80', account: '123456', amount: 1 })).toBeNull()
    expect(twqrTransfer({ bankCode: '808', account: '123', amount: 1 })).toBeNull()
    expect(twqrTransfer({ bankCode: '808', account: '123456', amount: 0 })).toBeNull()
  })
})
