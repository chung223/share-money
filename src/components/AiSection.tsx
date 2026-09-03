import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { aiStatus, parseWithOwnProvider, redeemAiCode, type AiStatus } from '../lib/ai'
import { AI_PRESETS, type AiFormat } from '../lib/receiptAi'

function OwnProvider() {
  const prov = useStore((s) => s.data.aiProvider)
  const update = useStore((s) => s.update)
  const showToast = useStore((s) => s.showToast)
  const [open, setOpen] = useState(!!prov)
  const [testing, setTesting] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const setProv = (patch: Partial<NonNullable<typeof prov>>) =>
    update((d) => (d.aiProvider = { format: 'openai', baseUrl: '', model: '', apiKey: '', ...(d.aiProvider ?? {}), ...patch }))
  const pickPreset = (id: string) => {
    const p = AI_PRESETS.find((x) => x.id === id)!
    setProv({ preset: id, format: p.format, baseUrl: p.baseUrl, model: p.model })
  }
  const test = async () => {
    if (!prov?.apiKey || !prov.baseUrl || !prov.model) return showToast('先填網址、模型、金鑰', '🙈')
    setTesting(true)
    try {
      const r = await parseWithOwnProvider({ format: prov.format, baseUrl: prov.baseUrl, model: prov.model, apiKey: prov.apiKey }, { text: '珍珠奶茶 x2 130\n雞排 70\n總計 200' })
      showToast(`OK！抓到 ${r.items.length} 項（${r.via === 'browser' ? '瀏覽器直連' : '經伺服器代轉'}）`, '✨')
    } catch (e) {
      showToast('失敗：' + (e instanceof Error ? e.message.slice(0, 120) : '未知'), '😵')
    } finally {
      setTesting(false)
    }
  }
  return (
    <div className="stack-s">
      <button type="button" className="link small" onClick={() => setOpen((v) => !v)}>
        {open ? '收起' : '🔑 用自己的 AI 金鑰（不占站方額度、無次數限制）'}
      </button>
      {open && (
        <div className="stack-s">
          <p className="muted small">支援 OpenAI 相容格式（OpenAI、Gemini、OpenRouter、Groq、MiniMax、Ollama…）和 Anthropic 格式。金鑰只存在你的裝置（有設 PIN 就一起加密），瀏覽器會直接呼叫該服務；被擋時才經本站代轉、代轉不留存。看圖要選有視覺能力的模型。</p>
          <div className="chip-row">
            {AI_PRESETS.map((p) => (
              <button key={p.id} type="button" className={`chip chip--xs ${prov?.preset === p.id ? 'is-on' : ''}`} onClick={() => pickPreset(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="row gap-s">
            {(['openai', 'anthropic'] as AiFormat[]).map((f) => (
              <button key={f} type="button" className={`chip chip--xs ${(prov?.format ?? 'openai') === f ? 'is-on' : ''}`} onClick={() => setProv({ format: f })}>
                {f === 'openai' ? 'OpenAI 格式' : 'Anthropic 格式'}
              </button>
            ))}
          </div>
          <input className="input input--expr" placeholder="Base URL，例：https://api.openai.com/v1" value={prov?.baseUrl ?? ''} onChange={(e) => setProv({ baseUrl: e.target.value.trim() })} />
          <input className="input input--expr" placeholder="模型，例：gpt-5-mini" value={prov?.model ?? ''} onChange={(e) => setProv({ model: e.target.value.trim() })} />
          <div className="row gap-s">
            <input className="input input--expr grow" type={showKey ? 'text' : 'password'} placeholder="API 金鑰" value={prov?.apiKey ?? ''} onChange={(e) => setProv({ apiKey: e.target.value.trim() })} autoComplete="off" />
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowKey((v) => !v)}>
              {showKey ? '隱藏' : '顯示'}
            </button>
          </div>
          <div className="row gap">
            <button type="button" className="btn btn--mint grow" disabled={testing} onClick={test}>
              {testing ? '測試中…' : '🧪 測試'}
            </button>
            {prov && (
              <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => update((d) => delete d.aiProvider)}>
                清除
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AiSection() {
  const cfg = useStore((s) => s.data.sync)
  const own = useStore((s) => !!s.data.aiProvider?.apiKey)
  const showToast = useStore((s) => s.showToast)
  const [st, setSt] = useState<AiStatus | null | 'loading'>('loading')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    aiStatus(true).then(setSt)
  }, [cfg?.secret])
  const redeem = async () => {
    setBusy(true)
    try {
      setSt(await redeemAiCode(code.trim()))
      showToast('AI 辨識開通了 ✨', '🎉')
      setCode('')
    } catch (e) {
      showToast(e instanceof Error ? e.message : '失敗', '😵')
    } finally {
      setBusy(false)
    }
  }
  const siteAi = st === 'loading' || (st && st.available)
  return (
    <section className="card stack">
      <div className="section-title">✨ AI 收據辨識</div>
      <p className="muted small">把收據照片或亂七八糟的訂單文字丟給 AI，直接整理成品項。可以用自己的金鑰，或用站方提供的（要邀請碼、有每日額度）。</p>
      {own && <div className="pill pill--mint center-self">🔑 目前用你自己的 AI</div>}
      <OwnProvider />
      {siteAi && <div className="label">站方 AI</div>}
      {!siteAi ? null : st === 'loading' ? (
        <p className="muted small">讀取中…</p>
      ) : !cfg || !st ? (
        <p className="small">要先開啟上面的多裝置同步（AI 額度是綁帳號算的）。</p>
      ) : st.allowed ? (
        <div className="row gap wrap center">
          <span className="pill pill--mint">✅ 已開通</span>
          <span className="muted small">
            今天用了 {st.used} / {st.quota} 次{st.remaining < st.quota - st.used ? '（全站額度快滿）' : ''}
          </span>
        </div>
      ) : (
        <div className="row gap">
          <input className="input grow" placeholder="邀請碼" value={code} onChange={(e) => setCode(e.target.value)} />
          <button type="button" className="btn btn--primary" disabled={busy || !code.trim()} onClick={redeem}>
            開通
          </button>
        </div>
      )}
      {st !== 'loading' && st && <p className="muted small">帳號 ID：{st.accountId}（站長開通時會用到）</p>}
    </section>
  )
}
