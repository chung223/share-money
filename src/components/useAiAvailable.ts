import { useEffect, useState } from 'react'
import { aiAvailable } from '../lib/ai'
import { useStore } from '../store'

/** 這台現在能不能用 AI（自己的金鑰或站方開通）。 */
export function useAiAvailable() {
  const own = useStore((s) => !!s.data.aiProvider?.apiKey)
  const sync = useStore((s) => !!s.data.sync)
  const [ok, setOk] = useState(own)
  useEffect(() => {
    let alive = true
    aiAvailable().then((v) => alive && setOk(v))
    return () => {
      alive = false
    }
  }, [own, sync])
  return ok
}
