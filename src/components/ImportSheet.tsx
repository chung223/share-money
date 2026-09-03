import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { decodeQrBytes, mergeEInvoice, parseEInvoice, type EInvoiceLeft, type EInvoiceRight } from '../lib/einvoice'
import { parseReceiptText, type ParsedRow } from '../lib/receiptText'
import { MoneyInput, Segmented, Sheet } from './ui'

export interface ImportResult {
  rows: { name: string; qty: number; price: number }[]
  total: number | null
  date: string | null
  source: 'qr' | 'ocr' | 'text'
}

type Tab = 'qr' | 'photo' | 'text'

export default function ImportSheet({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (r: ImportResult) => void }) {
  const [tab, setTab] = useState<Tab>('qr')
  const [review, setReview] = useState<ImportResult | null>(null)

  useEffect(() => {
    if (!open) setReview(null)
  }, [open])

  return (
    <Sheet open={open} onClose={onClose} title={review ? '確認明細' : '匯入明細'} tall>
      {review ? (
        <ReviewRows
          result={review}
          onBack={() => setReview(null)}
          onConfirm={(r) => {
            onImport(r)
            onClose()
          }}
        />
      ) : (
        <div className="stack">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'qr', label: '🧾 發票 QR' },
              { value: 'photo', label: '📷 拍照辨識' },
              { value: 'text', label: '📋 貼上文字' },
            ]}
          />
          {tab === 'qr' && open && <QrScanner onDone={setReview} />}
          {tab === 'photo' && <PhotoOcr onDone={setReview} />}
          {tab === 'text' && <PasteText onDone={setReview} />}
        </div>
      )}
    </Sheet>
  )
}

/* ---------------- QR scanner (Taiwan e-invoice) ---------------- */

function QrScanner({ onDone }: { onDone: (r: ImportResult) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [left, setLeft] = useState<EInvoiceLeft | null>(null)
  const [right, setRight] = useState<EInvoiceRight | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [active, setActive] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const stateRef = useRef({ left, right })
  stateRef.current = { left, right }

  const handleText = useCallback((text: string) => {
    const part = parseEInvoice(text)
    if (!part) return false
    if (part.kind === 'left') setLeft(part)
    else setRight(part)
    if (navigator.vibrate) navigator.vibrate(40)
    return true
  }, [])

  // camera loop
  useEffect(() => {
    if (!active) return
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const video = videoRef.current!
    const canvas = canvasRef.current ?? (canvasRef.current = document.createElement('canvas'))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        video.srcObject = stream
        await video.play()
        let lastText = ''
        let lastAt = 0
        const tick = () => {
          if (stopped) return
          if (video.readyState >= 2) {
            const w = video.videoWidth
            const h = video.videoHeight
            if (w && h) {
              canvas.width = w
              canvas.height = h
              ctx.drawImage(video, 0, 0, w, h)
              const img = ctx.getImageData(0, 0, w, h)
              const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
              if (code && code.data) {
                const text = decodeQrBytes(code.binaryData, code.data)
                const now = Date.now()
                if (text !== lastText || now - lastAt > 1500) {
                  lastText = text
                  lastAt = now
                  handleText(text)
                }
              }
            }
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch (e) {
        setErr('打不開相機：' + (e instanceof Error ? e.message : '') + '。可以改用下面的「選照片」。')
      }
    })()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [active, handleText])

  const onFile = async (f: File | undefined) => {
    if (!f) return
    const bmp = await createImageBitmap(f)
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    // A photo usually holds both QR codes side by side; scan the whole image then each half.
    const regions = [
      [0, 0, canvas.width, canvas.height],
      [0, 0, Math.floor(canvas.width / 2) + 40, canvas.height],
      [Math.floor(canvas.width / 2) - 40, 0, canvas.width - Math.floor(canvas.width / 2) + 40, canvas.height],
    ]
    let found = 0
    for (const [x, y, w, h] of regions) {
      const img = ctx.getImageData(x, y, w, h)
      const code = jsQR(img.data, w, h)
      if (code?.data && handleText(decodeQrBytes(code.binaryData, code.data))) found++
    }
    if (!found) setErr('這張照片裡找不到發票 QR，試著拍近一點、對正一點。')
    else setErr(null)
  }

  const finish = () => {
    if (!left) return
    const m = mergeEInvoice(left, right)
    onDone({ rows: m.items, total: m.total, date: m.date, source: 'qr' })
  }
  const complete = left ? mergeEInvoice(left, right).complete : false
  useEffect(() => {
    if (left && complete) {
      setActive(false)
      const t = setTimeout(finish, 350)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, right, complete])

  return (
    <div className="stack">
      <div className="scanner">
        <video ref={videoRef} className="scanner__video" playsInline muted />
        <div className="scanner__frame" />
        <div className="scanner__status">
          <span className={`scan-badge ${left ? 'is-on' : ''}`}>{left ? '✓ 左 QR' : '左 QR'}</span>
          <span className={`scan-badge ${right ? 'is-on' : ''}`}>{right ? '✓ 右 QR' : '右 QR'}</span>
        </div>
      </div>
      <p className="muted small center-text">
        {err ? err : left ? (complete ? '掃到啦！' : '左邊好了，把鏡頭移到右邊那顆 QR') : '把發票下方的兩顆 QR 對進框裡，會自動辨識'}
      </p>
      <div className="row gap wrap">
        <button type="button" className="btn btn--ghost grow" onClick={() => fileRef.current?.click()}>
          🖼 從相簿選照片
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        {left && !complete && (
          <button type="button" className="btn btn--primary grow" onClick={finish}>
            先用左邊的 {left.items.length} 項
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------------- Photo OCR ---------------- */

function PhotoOcr({ onDone }: { onDone: (r: ImportResult) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = async (f: File | undefined) => {
    if (!f) return
    setErr(null)
    setBusy(true)
    setProgress(0)
    setStatus('準備中…')
    setPreview(URL.createObjectURL(f))
    try {
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker(['chi_tra', 'eng'], 1, {
        logger: (m: { status: string; progress: number }) => {
          setStatus(
            m.status === 'recognizing text' ? '辨識中…' : m.status.includes('loading') || m.status.includes('download') ? '下載辨識模型（第一次會久一點）…' : m.status,
          )
          setProgress(Math.round((m.progress ?? 0) * 100))
        },
      })
      await worker.setParameters({ preserve_interword_spaces: '1' })
      const img = await downscale(f, 1800)
      const { data } = await worker.recognize(img)
      await worker.terminate()
      const parsed = parseReceiptText(data.text)
      if (!parsed.rows.length) {
        setErr('沒抓到任何品項。光線好一點、拍正一點會更準；或改用「貼上文字」。')
        return
      }
      onDone({ rows: parsed.rows.map(({ name, qty, price }) => ({ name, qty, price })), total: parsed.total, date: parsed.date, source: 'ocr' })
    } catch (e) {
      setErr('辨識失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div className="ocr-box">
        {preview ? <img src={preview} alt="" className="ocr-box__img" /> : <div className="ocr-box__hint">📷 拍下收據、電子明細截圖，或從相簿選</div>}
        {busy && (
          <div className="ocr-box__overlay">
            <div className="spinner" />
            <div>{status}</div>
            <div className="bar">
              <div className="bar__fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>
      {err && <p className="small danger-text center-text">{err}</p>}
      <p className="muted small center-text">辨識在你的手機裡完成，照片不會上傳。辨識完可以再手動修正。</p>
      <div className="row gap">
        <button type="button" className="btn btn--primary grow" disabled={busy} onClick={() => fileRef.current?.click()}>
          {preview ? '再拍一張' : '📷 拍照 / 選圖片'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => run(e.target.files?.[0])} />
      </div>
    </div>
  )
}

async function downscale(f: File, max: number): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(f)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  const ctx = c.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  return c
}

/* ---------------- Paste text ---------------- */

function PasteText({ onDone }: { onDone: (r: ImportResult) => void }) {
  const [text, setText] = useState('')
  const parsed = parseReceiptText(text)
  return (
    <div className="stack">
      <textarea
        className="input textarea"
        rows={8}
        placeholder={'一行一個品項，最後放金額，例如：\n味噌拉麵 180\n煎餃 x2 120\n可樂 30'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="muted small">
        {parsed.rows.length ? `抓到 ${parsed.rows.length} 項` : '也可以直接貼 Uber Eats、foodpanda 的訂單文字'}
        {parsed.total != null ? `，總計 ${parsed.total}` : ''}
      </p>
      <button
        type="button"
        className="btn btn--primary"
        disabled={!parsed.rows.length}
        onClick={() => onDone({ rows: parsed.rows.map(({ name, qty, price }) => ({ name, qty, price })), total: parsed.total, date: parsed.date, source: 'text' })}
      >
        下一步
      </button>
    </div>
  )
}

/* ---------------- Review ---------------- */

function ReviewRows({ result, onBack, onConfirm }: { result: ImportResult; onBack: () => void; onConfirm: (r: ImportResult) => void }) {
  const [rows, setRows] = useState<ParsedRow[]>(result.rows.map((r) => ({ ...r, raw: '' })))
  const sum = rows.reduce((a, r) => a + r.price * r.qty, 0)
  const mismatch = result.total != null && Math.abs(sum - result.total) > 0.5
  const set = (i: number, patch: Partial<ParsedRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="stack">
      <div className="muted small">
        {result.source === 'qr' ? '從電子發票讀到' : result.source === 'ocr' ? '辨識結果，請順手檢查一下' : '解析結果'}
        {result.date ? ` · ${result.date}` : ''}
      </div>
      <div className="stack-s">
        {rows.map((r, i) => (
          <div key={i} className="review-row">
            <input className="input grow" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
            <input className="input input--qty" inputMode="numeric" value={r.qty} onChange={(e) => set(i, { qty: Math.max(1, Number(e.target.value) || 1) })} />
            <MoneyInput value={r.price} onChange={(price) => set(i, { price })} />
            <button type="button" className="icon-btn icon-btn--sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="刪除">
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn--ghost" onClick={() => setRows((rs) => [...rs, { name: '', qty: 1, price: 0, raw: '' }])}>
        ＋ 加一項
      </button>
      <div className={`review-total ${mismatch ? 'is-warn' : ''}`}>
        <span>品項合計 {sum.toLocaleString()}</span>
        {result.total != null && <span>{mismatch ? `⚠️ 明細總計是 ${result.total.toLocaleString()}` : '✓ 跟總計一致'}</span>}
      </div>
      {mismatch && <p className="muted small">合計對不上通常是折扣、服務費或漏掃品項。可以先匯入，再到「額外費用」補上折扣或服務費。</p>}
      <div className="row gap">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          返回
        </button>
        <button
          type="button"
          className="btn btn--primary grow"
          disabled={!rows.some((r) => r.name.trim())}
          onClick={() => onConfirm({ ...result, rows: rows.filter((r) => r.name.trim()).map(({ name, qty, price }) => ({ name: name.trim(), qty, price })) })}
        >
          加入 {rows.filter((r) => r.name.trim()).length} 項
        </button>
      </div>
    </div>
  )
}
