import type { Trip } from '../lib/types'
import { Sheet } from './ui'

/** 共編：第二階段接上伺服器旅程通道，這裡先放說明。 */
export default function TripShareSheet({ trip, open, onClose }: { trip: Trip; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="👥 共編這趟旅程">
      <div className="stack">
        <p className="muted small">{trip.share ? '共編中。' : '共編功能建置中：之後可以把連結丟給同行的人，大家一起記、一起看結算。'}</p>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          好
        </button>
      </div>
    </Sheet>
  )
}
