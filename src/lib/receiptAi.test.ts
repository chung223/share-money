import { describe, expect, it } from 'vitest'
import { buildRequest, callProvider, extractText, isPublicHttpsUrl, normalise } from './receiptAi'

describe('receiptAi', () => {
  it('builds openai-format requests with image_url and anthropic-format with image blocks', () => {
    const img = { mediaType: 'image/jpeg', base64: 'AAAA' }
    const o = buildRequest({ format: 'openai', baseUrl: 'https://api.openai.com/v1/', model: 'gpt-5-mini', apiKey: 'sk' }, { image: img })
    expect(o.url).toBe('https://api.openai.com/v1/chat/completions')
    expect((o.init.headers as Record<string, string>).authorization).toBe('Bearer sk')
    expect(JSON.parse(o.init.body as string).messages[1].content[0].image_url.url).toBe('data:image/jpeg;base64,AAAA')
    const a = buildRequest({ format: 'anthropic', baseUrl: '', model: 'claude', apiKey: 'k' }, { text: 'x' }, { browser: true })
    expect(a.url).toBe('https://api.anthropic.com/v1/messages')
    const h = a.init.headers as Record<string, string>
    expect(h['x-api-key']).toBe('k')
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(JSON.parse(a.init.body as string).system).toContain('收據')
  })
  it('extracts text from both response shapes and surfaces API errors', () => {
    expect(extractText('openai', { choices: [{ message: { content: 'hi' } }] })).toBe('hi')
    expect(extractText('openai', { choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }] })).toBe('ab')
    expect(extractText('anthropic', { content: [{ type: 'text', text: 'z' }] })).toBe('z')
    expect(() => extractText('openai', { error: { message: 'bad key' } })).toThrow('bad key')
    expect(() => extractText('openai', { base_resp: { status_code: 1004, status_msg: 'auth' } })).toThrow('1004')
  })
  it('callProvider end-to-end with a fake fetch', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"items":[{"name":"a","qty":2,"price":"5"}],"total":10}\n```' } }] }), { status: 200 })) as unknown as typeof fetch
    const out = await callProvider({ format: 'openai', baseUrl: 'https://x.test/v1', model: 'm', apiKey: 'k' }, { text: 'a 10' }, { fetchFn })
    expect(out.items).toEqual([{ name: 'a', qty: 2, price: 5 }])
    const bad = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    await expect(callProvider({ format: 'openai', baseUrl: 'https://x.test/v1', model: 'm', apiKey: 'k' }, { text: 'a' }, { fetchFn: bad })).rejects.toThrow('HTTP 401')
  })
  it('normalise handles prose after JSON', () => {
    expect(normalise('{"items":[],"total":5} 以上 {"x":1}').total).toBe(5)
    expect(() => normalise('nothing')).toThrow()
  })
  it('blocks non-https and private hosts for the proxy', () => {
    expect(isPublicHttpsUrl('https://api.openai.com/v1')).toBe(true)
    expect(isPublicHttpsUrl('http://api.openai.com/v1')).toBe(false)
    expect(isPublicHttpsUrl('https://localhost:3456')).toBe(false)
    expect(isPublicHttpsUrl('https://10.0.0.5/v1')).toBe(false)
    expect(isPublicHttpsUrl('https://192.168.1.1/v1')).toBe(false)
    expect(isPublicHttpsUrl('https://[::1]/v1')).toBe(false)
    expect(isPublicHttpsUrl('garbage')).toBe(false)
  })
})
