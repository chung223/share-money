import { useEffect, useState } from 'react'

export type Route = { name: 'home' } | { name: 'project'; id: string; tab?: 'items' | 'result' } | { name: 'settings' }

function parse(hash: string): Route {
  const h = hash.replace(/^#/, '')
  const m = /^\/p\/([^/]+)(?:\/(items|result))?/.exec(h)
  if (m) return { name: 'project', id: m[1], tab: (m[2] as 'items' | 'result') ?? 'items' }
  if (h.startsWith('/settings')) return { name: 'settings' }
  return { name: 'home' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash))
  useEffect(() => {
    const on = () => setRoute(parse(location.hash))
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return route
}

export function navigate(to: string, replace = false) {
  if (replace) location.replace('#' + to)
  else location.hash = to
}
