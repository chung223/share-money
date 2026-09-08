import { describe, expect, it } from 'vitest'
import { fmtDateShort, payLines, reminderText } from './reminder'
import { computeSplit } from './split'
import type { Project } from './types'

const me = { id: 'me', name: '我', emoji: '🐥', color: 'butter' }
const ming = { id: 'm', name: '小明', emoji: '🐰', color: 'mint' }
const p: Project = { id: 'p', name: '拉麵聚', emoji: '🍜', date: '2026-09-04', createdAt: 1, updatedAt: 1, currency: 'TWD', rate: null, mode: 'equal', payerId: 'me', people: [me, ming], items: [{ id: 'i', name: '總額', price: 500, qty: 1, sharedBy: 'all', kind: 'shared' }], extras: [], settled: {} }

describe('reminder', () => {
  it('formats dates with weekday', () => {
    expect(fmtDateShort('2026-09-04')).toBe('9/4（五）')
    expect(fmtDateShort('nope')).toBe('nope')
  })
  it('builds pay lines', () => {
    expect(payLines()).toEqual([])
    expect(payLines({ bankCode: '808', account: '123' })).toEqual(['808 123'])
    expect(payLines({ bankCode: '808', bankName: '玉山', account: '123', linePay: 'https://x', note: 'hi' })).toEqual(['808 玉山 123', 'https://x', 'hi'])
    expect(payLines({ account: '123' })).toEqual(['123'])
  })
  it('renders each tone with amount and pay info', () => {
    const r = computeSplit(p).people.find((x) => x.person.id === 'm')!
    const t = reminderText({ project: p, person: r, baseCurrency: 'TWD', payInfo: { bankCode: '808', account: '1234567890' }, shareUrl: 'https://spilt.chung.men/s/abc#k', tone: 'normal' })
    expect(t).toBe('小明～ 9/4（五） 🍜拉麵聚你的部分是 NT$250\n轉這裡就好：\n808 1234567890\n明細看這裡：https://spilt.chung.men/s/abc#k')
    expect(reminderText({ project: p, person: r, baseCurrency: 'TWD', tone: 'cute' })).toContain('🥺')
    expect(reminderText({ project: p, person: r, baseCurrency: 'TWD', tone: 'angry' })).toContain('😤')
  })
  it('shows base currency for foreign projects', () => {
    const jp = { ...p, currency: 'JPY', rate: 0.21 }
    const r = computeSplit(jp).people.find((x) => x.person.id === 'm')!
    expect(reminderText({ project: jp, person: r, baseCurrency: 'TWD', tone: 'normal' })).toMatch(/¥250（約 NT\$5[23]）/)
  })
})
