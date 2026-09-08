import { useState } from 'react'
import { useStore, newItem, uid } from '../store'
import { navigate } from '../router'
import { lineApi, type LineDraft } from '../lib/line'
import { aiParse } from '../lib/ai'
import { useAiAvailable } from './useAiAvailable'
import { CURRENCIES } from '../lib/types'
import { Sheet } from './ui'
import QuickCreateSheet from './QuickCreateSheet'

/** LINE 傳來的草稿：一句話 → AI 開帳本；收據 → 直接建帳本。 */
export default function LineInboxSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const drafts = useStore((s) => s.lineDrafts)
  const setLineDrafts = useStore((s) => s.setLineDrafts)
  const addProject = useStore((s) => s.addProject)
  const updateProject = useStore((s) => s.updateProject)
  const showToast = useStore((s) => s.showToast)
  const base = useStore((s) => s.data.baseCurrency)
  const ai = useAiAvailable()
  const [quick, setQuick] = useState<LineDraft | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const dismiss = async (d: LineDraft) => {
    setLineDrafts(drafts.filter((x) => x.id !== d.id))
    await lineApi.ack([d.id]).catch(() => {})
  }
  const createFromReceipt = (d: LineDraft, r: NonNullable<LineDraft['payload']['receipt']>) => {
    const p = addProject(undefined, 'food')
    updateProject(p.id, (pp) => {
      pp.name = r.merchant ?? ''
      if (r.date) pp.date = r.date
      if (r.currency && r.currency !== pp.currency && CURRENCIES.some((c) => c.code === r.currency)) {
        pp.currency = r.currency
        pp.rate = r.currency === base ? null : pp.rate
      }
      pp.items = r.items.map((it) => newItem({ name: it.name, qty: it.qty, price: it.price }))
      for (const e of r.extras ?? []) pp.extras.push({ id: uid(), name: e.name, emoji: e.amount < 0 ? '🏷️' : '🧂', type: 'fixed', value: e.amount, split: 'proportional' })
      if (r.items.length > 1) pp.mode = 'items'
    })
    dismiss(d)
    onClose()
    navigate(`/p/${p.id}`)
    showToast('帳本建好了，去加人吧', '✨')
  }
  const parseImage = async (d: LineDraft) => {
    if (!d.payload.image) return
    setBusy(d.id)
    try {
      const r = await aiParse({ image: d.payload.image })
      if (!r.items.length) return showToast('AI 沒看出品項', '🤔')
      createFromReceipt(d, r)
    } catch (e) {
      showToast(e instanceof Error ? e.message.slice(0, 100) : 'AI 失敗', '😵')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title="💚 LINE 收件匣" tall>
        <div className="stack">
          {drafts.length === 0 ? (
            <p className="muted center-text">目前沒有東西 🎉</p>
          ) : (
            drafts.map((d) => (
              <div key={d.id} className="card stack-s">
                <div className="muted small">{new Date(d.createdAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                {d.kind === 'text' && (
                  <>
                    <div className="strong">💬 {d.payload.text}</div>
                    <div className="row gap">
                      <button type="button" className="btn btn--primary grow" disabled={!ai} onClick={() => setQuick(d)}>
                        ✨ AI 開帳本
                      </button>
                      <button type="button" className="btn btn--ghost" onClick={() => dismiss(d)}>
                        略過
                      </button>
                    </div>
                    {!ai && <p className="muted small">要用 AI 開帳本需先在設定開通 AI 或填自己的金鑰。</p>}
                  </>
                )}
                {d.kind === 'receipt' && d.payload.receipt && (
                  <>
                    <div className="strong">🧾 {d.payload.receipt.merchant ?? '收據'} · {d.payload.receipt.items.length} 項{d.payload.receipt.total != null ? ` · 總計 ${d.payload.receipt.total}` : ''}</div>
                    <div className="muted small">{d.payload.receipt.items.slice(0, 5).map((i) => i.name).join('、')}{d.payload.receipt.items.length > 5 ? '…' : ''}</div>
                    <div className="row gap">
                      <button type="button" className="btn btn--primary grow" onClick={() => createFromReceipt(d, d.payload.receipt!)}>
                        建立帳本
                      </button>
                      <button type="button" className="btn btn--ghost" onClick={() => dismiss(d)}>
                        略過
                      </button>
                    </div>
                  </>
                )}
                {d.kind === 'image' && d.payload.image && (
                  <>
                    <img src={`data:${d.payload.image.mediaType};base64,${d.payload.image.base64}`} alt="" className="ocr-box__img" style={{ maxHeight: 180, objectFit: 'contain' }} />
                    <div className="row gap">
                      <button type="button" className="btn btn--primary grow" disabled={!ai || busy === d.id} onClick={() => parseImage(d)}>
                        {busy === d.id ? 'AI 辨識中…' : '✨ AI 辨識並建帳本'}
                      </button>
                      <button type="button" className="btn btn--ghost" onClick={() => dismiss(d)}>
                        略過
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </Sheet>
      <QuickCreateSheet open={!!quick} onClose={() => setQuick(null)} initialText={quick?.payload.text} onCreated={() => quick && dismiss(quick)} />
    </>
  )
}
