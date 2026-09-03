import { describe, expect, it } from 'vitest'
import { buildAppUrl, isSafeAppUrl, twqrTransfer } from './twqr'

describe('twqrTransfer', () => {
  it('matches OpenTWQR: punycode host, 16-digit account, amount in cents, D10=901, optional D9 note', () => {
    expect(twqrTransfer({ bankCode: '013', account: '699500327859', amount: 250 })).toBe('TWQRP://xn--gmqw5ax42ad01c/158/02/V1?D5=013&D6=0000699500327859&D1=25000&D10=901')
    expect(twqrTransfer({ bankCode: '812', account: '0001234567890', amount: 1000, note: '🍜 拉麵聚' })).toBe('TWQRP://xn--gmqw5ax42ad01c/158/02/V1?D5=812&D6=0000001234567890&D1=100000&D10=901&D9=%E6%8B%89%E9%BA%B5%E8%81%9A')
    expect(twqrTransfer({ bankCode: '004', account: '1234-5678', amount: 12.5 })).toContain('D1=1250')
  })
  it('rejects bad input', () => {
    expect(twqrTransfer({ bankCode: '80', account: '123456', amount: 1 })).toBeNull()
    expect(twqrTransfer({ bankCode: '808', account: '000', amount: 1 })).toBeNull()
    expect(twqrTransfer({ bankCode: '808', account: '123456', amount: 0 })).toBeNull()
    expect(twqrTransfer({ bankCode: '808', account: '123456', amount: 3_000_000 })).toBeNull()
  })
})

describe('buildAppUrl', () => {
  it('fills placeholders', () => {
    expect(buildAppUrl('mybank://t?a={account}&p={paddedAccount}&b={bankCode}&m={amount}&c={amountCents}&n={note}', { bankCode: '013', account: '0012-3456', amount: 250.4, note: '拉麵' })).toBe(
      'mybank://t?a=00123456&p=0000000000123456&b=013&m=250&c=25000&n=%E6%8B%89%E9%BA%B5',
    )
  })
  it('blocks dangerous schemes', () => {
    expect(isSafeAppUrl('jkopay://')).toBe(true)
    expect(isSafeAppUrl('intent://#Intent;package=x;end')).toBe(true)
    expect(isSafeAppUrl('https://x.y')).toBe(true)
    expect(isSafeAppUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeAppUrl('hello')).toBe(false)
  })
})
