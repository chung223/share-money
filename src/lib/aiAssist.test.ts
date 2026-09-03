import { describe, expect, it } from 'vitest'
import { applyDraft, normaliseAssign, normaliseDraft, reminderUser } from './aiAssist'
import { newProject, newPerson } from '../store'
import { computeSplit } from './split'

const me = { id: 'me', name: '阿賴', emoji: '🐥', color: 'butter' }
const ming = { id: 'm', name: '小明', emoji: '🐰', color: 'mint' }
const ctx = { me, friends: [ming], baseCurrency: 'TWD', today: '2026-09-04' }

describe('normaliseDraft + applyDraft', () => {
  it('maps names to known people, adds me, and builds a working project', () => {
    const raw = `好的：{"name":"拉麵聚","emoji":"🍜","category":"food","date":"2026-09-03","currency":"TWD","mode":"items","people":["我","小明","小華"],"payer":"我","items":[{"name":"牛肉麵","qty":1,"price":180,"sharedBy":["小明"],"kind":"main"},{"name":"小菜","qty":1,"price":60,"sharedBy":"all","kind":"shared"}],"extras":[{"name":"服務費","amount":10,"type":"percent"}]}`
    const d = normaliseDraft(raw, ctx)
    expect(d.people).toEqual([{ name: '阿賴', id: 'me' }, { name: '小明', id: 'm' }, { name: '小華' }])
    expect(d.payer).toBe('阿賴')
    const p = newProject(me, 'TWD')
    const created = applyDraft(p, d, { me, friends: [ming], newPerson })
    expect(created.map((x) => x.name)).toEqual(['小華'])
    expect(p.people.map((x) => x.name)).toEqual(['阿賴', '小明', '小華'])
    expect(p.items[0].sharedBy).toEqual(['m'])
    expect(p.extras[0]).toMatchObject({ type: 'percent', value: 10 })
    const r = computeSplit(p, 'TWD')
    expect(r.grandTotal).toBe(264) // 240 + 10%
  })
  it('falls back sanely on garbage fields', () => {
    const d = normaliseDraft('{"people":["小明"],"payer":"路人","mode":"weird","category":"nope","items":[{"name":"總額","price":"900"}]}', ctx)
    expect(d.mode).toBe('equal')
    expect(d.category).toBe('food')
    expect(d.payer).toBe('阿賴')
    expect(d.people[0].id).toBe('me')
    expect(d.items[0].price).toBe(900)
    expect(() => normaliseDraft('nothing', ctx)).toThrow()
  })
})

describe('normaliseAssign', () => {
  it('maps names to ids and enforces main = exactly one person', () => {
    const items = [
      { id: 'a', name: '牛肉麵', qty: 1, price: 1, sharedBy: 'all' as const, kind: 'shared' as const },
      { id: 'b', name: '小菜', qty: 1, price: 1, sharedBy: 'all' as const, kind: 'shared' as const },
    ]
    const out = normaliseAssign('{"items":[{"i":0,"sharedBy":["小明"],"kind":"main"},{"i":1,"sharedBy":"all","kind":"main"},{"i":9,"sharedBy":["x"]}]}', items, [me, ming])
    expect(out).toEqual([{ sharedBy: ['m'], kind: 'main' }, { sharedBy: 'all', kind: 'shared' }])
  })
})

describe('reminderUser', () => {
  it('includes pay lines and link', () => {
    const u = reminderUser({ toName: '小明', amountText: 'NT$250', what: '9/3 拉麵', daysAgo: 2, tone: '可愛', payLines: ['808 123'], link: 'https://x/s/1#k' })
    expect(u).toContain('808 123')
    expect(u).toContain('https://x/s/1#k')
  })
})
