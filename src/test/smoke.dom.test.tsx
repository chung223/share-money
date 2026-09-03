// @vitest-environment jsdom
/**
 * Renders every page in jsdom and fails on any React error (infinite loops, undefined access...).
 * Not a visual test; it exists so a broken selector never ships a blank page again.
 */
import 'fake-indexeddb/auto'
import { vi as vitest } from 'vitest'
vitest.mock('virtual:pwa-register', () => ({ registerSW: () => () => Promise.resolve() }))
;(globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = 'test'
import { act, render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// jsdom gaps
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }),
})
;(globalThis as { structuredClone?: unknown }).structuredClone ??= (v: unknown) => JSON.parse(JSON.stringify(v))

import App from '../App'
import { useStore, newProject } from '../store'

beforeEach(async () => {
  localStorage.clear()
  await useStore.getState().wipe() // fake-indexeddb persists across tests in a file
  location.hash = ''
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    throw new Error('console.error: ' + a.map(String).join(' '))
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function boot(onboarded = true) {
  useStore.setState({ prefs: { ...useStore.getState().prefs, onboarded }, tutorialOpen: false })
  render(<App />)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
}

describe('pages render without crashing', () => {
  it('home (empty), settings, and a project with people, payments, partial and groups', async () => {
    await boot()
    expect(await screen.findByText('還沒有帳本呢')).toBeTruthy()

    await act(async () => {
      useStore.getState().update((d) => {
        d.friends.push({ id: 'f1', name: '小明', emoji: '🐰', color: 'mint' }, { id: 'f2', name: '小華', emoji: '🐻', color: 'sky' })
        d.groups = [{ id: 'g1', name: '拉麵團', emoji: '🍜', personIds: ['me', 'f1', 'f2'], mode: 'items' }]
        d.payInfo = { bankCode: '808', account: '123' }
        const p = newProject(d.me, 'TWD')
        p.name = '測試'
        p.people = [d.me, ...d.friends]
        p.items = [{ id: 'i1', name: '總額', price: 1000, qty: 1, sharedBy: 'all', kind: 'shared' }]
        p.payments = [{ personId: 'me', amount: 700 }, { personId: 'f1', amount: 300 }]
        p.partial = { f2_me: 100 }
        p.rounding = 10
        d.projects.push(p)
      })
    })
    expect(await screen.findByText('測試')).toBeTruthy()

    location.hash = '/settings'
    await act(async () => {
      dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(await screen.findByText('🍱 常用組合')).toBeTruthy()
    expect(screen.getByText('☁️ 多裝置同步')).toBeTruthy()

    const id = useStore.getState().data.projects[0].id
    location.hash = `/p/${id}/items`
    await act(async () => {
      dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(await screen.findByText('👯 誰一起')).toBeTruthy()

    location.hash = `/p/${id}/result`
    await act(async () => {
      dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(await screen.findByText('💸 誰轉給誰')).toBeTruthy()
  })

  it('project without payments (single payer) shows settle buttons', async () => {
    await boot()
    await act(async () => {
      useStore.getState().update((d) => {
        const p = newProject(d.me, 'JPY')
        p.people = [d.me, { id: 'f1', name: '小明', emoji: '🐰', color: 'mint' }]
        p.items = [{ id: 'i1', name: '總額', price: 3000, qty: 1, sharedBy: 'all', kind: 'shared' }]
        p.rate = 0.22
        d.projects.push(p)
      })
    })
    const id = useStore.getState().data.projects[0].id
    location.hash = `/p/${id}/result`
    await act(async () => {
      dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(await screen.findByText('還沒還')).toBeTruthy()
    expect(screen.getByText('📣 催款')).toBeTruthy()
  })
})

describe('onboarding', () => {
  it('shows on a fresh device and walks through the steps', async () => {
    await boot(false)
    expect(await screen.findByText('開始 →')).toBeTruthy()
    await act(async () => {
      screen.getByText('開始 →').click()
    })
    expect(await screen.findByText('下一步 →')).toBeTruthy()
    await act(async () => {
      screen.getByText('下一步 →').click()
    })
    // name is required on step 1; type one and continue -> pay info step, still inside the tutorial
    const input = screen.getByPlaceholderText('名字') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '小賴')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      screen.getByText('下一步 →').click()
    })
    expect(await screen.findByText('💳 怎麼收錢（選填）')).toBeTruthy()
    expect(useStore.getState().data.me.name).toBe('小賴')
  })
})
