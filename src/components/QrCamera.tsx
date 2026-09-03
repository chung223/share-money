import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

/** Rear-camera QR reader. Calls onText for every distinct code seen; parent decides when to stop. */
export default function QrCamera({ onText, hint }: { onText: (text: string) => boolean | void; hint?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cb = useRef(onText)
  cb.current = onText

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const video = videoRef.current!
    const canvas = document.createElement('canvas')
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
          if (video.readyState >= 2 && video.videoWidth) {
            const w = (canvas.width = video.videoWidth)
            const h = (canvas.height = video.videoHeight)
            ctx.drawImage(video, 0, 0, w, h)
            const img = ctx.getImageData(0, 0, w, h)
            const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
            if (code?.data) {
              const t = Date.now()
              if (code.data !== lastText || t - lastAt > 1500) {
                lastText = code.data
                lastAt = t
                if (cb.current(code.data)) {
                  if (navigator.vibrate) navigator.vibrate(40)
                  stopped = true
                  stream?.getTracks().forEach((x) => x.stop())
                  return
                }
              }
            }
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch (e) {
        setErr('打不開相機：' + (e instanceof Error ? e.message : '') + '。可以改用「選照片」。')
      }
    })()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const onFile = async (f: File | undefined) => {
    if (!f) return
    const bmp = await createImageBitmap(f)
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height)
    const code = jsQR(img.data, bmp.width, bmp.height)
    if (!code?.data || !cb.current(code.data)) setErr('這張照片裡沒有讀到正確的 QR。')
  }

  return (
    <div className="stack-s">
      <div className="scanner">
        <video ref={videoRef} playsInline muted className="scanner__video" />
        <div className="scanner__frame" />
      </div>
      {hint && <p className="muted small center-text">{hint}</p>}
      {err && <p className="small danger-text">{err}</p>}
      <button type="button" className="btn btn--ghost" onClick={() => fileRef.current?.click()}>
        🖼 選照片
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
    </div>
  )
}
