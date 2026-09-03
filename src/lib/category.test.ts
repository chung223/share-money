import { describe, expect, it } from 'vitest'
import { CATEGORIES, categoryOf, emojiOptions, modeLabel } from './category'

describe('category', () => {
  it('guesses from emoji for old projects and honours explicit category', () => {
    expect(categoryOf({ emoji: '🚕' }).id).toBe('transport')
    expect(categoryOf({ emoji: '🍜' }).id).toBe('food')
    expect(categoryOf({ emoji: '🤷' }).id).toBe('food')
    expect(categoryOf({ emoji: '🍜', category: 'shopping' }).id).toBe('shopping')
  })
  it('mode labels follow the category', () => {
    expect(modeLabel('mains', categoryOf({ emoji: '🍜' }))).toBe('主餐+共享')
    expect(modeLabel('mains', categoryOf({ emoji: '🚕' }))).toBe('個人+共乘')
    expect(modeLabel('equal', CATEGORIES[3])).toBe('均攤')
  })
  it('emoji options start with the category and have no duplicates', () => {
    const opts = emojiOptions(CATEGORIES[1])
    expect(opts[0]).toBe('🚕')
    expect(new Set(opts).size).toBe(opts.length)
  })
})
