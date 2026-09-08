import { applyUpdate, useUpdate } from '../lib/update'

export default function UpdateBanner() {
  const need = useUpdate((s) => s.needRefresh)
  if (!need) return null
  return (
    <div className="update-banner" role="status">
      <span>🆕 有新版本</span>
      <button type="button" className="btn btn--sm btn--primary" onClick={applyUpdate}>
        更新
      </button>
    </div>
  )
}
