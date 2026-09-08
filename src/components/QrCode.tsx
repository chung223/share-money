import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export default function QrCode({ text, size = 220 }: { text: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(text, { width: size * 2, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#3b2e2a', light: '#ffffff' } })
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null))
    return () => {
      alive = false
    }
  }, [text, size])
  return (
    <div className="qr" style={{ width: size, height: size }}>
      {url && <img src={url} width={size} height={size} alt="QR code" />}
    </div>
  )
}
