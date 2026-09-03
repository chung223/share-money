import { useEffect } from 'react'
import { useStore } from './store'
import { useRoute } from './router'
import LockScreen from './pages/LockScreen'
import Home from './pages/Home'
import ProjectPage from './pages/ProjectPage'
import SettingsPage from './pages/SettingsPage'
import { Mascot } from './components/ui'
import UpdateBanner from './components/UpdateBanner'

function useTheme() {
  const theme = useStore((s) => s.prefs.theme)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

function useAutoLock() {
  const encrypted = useStore((s) => s.encrypted)
  const locked = useStore((s) => s.locked)
  const delay = useStore((s) => s.prefs.lockDelay)
  const lock = useStore((s) => s.lock)
  useEffect(() => {
    if (!encrypted || locked) return
    let hiddenAt: number | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        if (delay === 0) lock()
        else timer = setTimeout(lock, delay * 1000)
      } else {
        if (timer) clearTimeout(timer)
        timer = null
        if (hiddenAt && Date.now() - hiddenAt > delay * 1000) lock()
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      if (timer) clearTimeout(timer)
    }
  }, [encrypted, locked, delay, lock])
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const locked = useStore((s) => s.locked)
  const init = useStore((s) => s.init)
  const toast = useStore((s) => s.toast)
  const route = useRoute()
  useTheme()
  useAutoLock()
  useEffect(() => {
    init()
  }, [init])

  if (!ready) {
    return (
      <div className="splash">
        <Mascot size={96} className="mascot--float" />
        <div className="splash__name">반반</div>
      </div>
    )
  }
  if (locked) return <LockScreen />

  let page
  if (route.name === 'project') page = <ProjectPage id={route.id} tab={route.tab ?? 'items'} />
  else if (route.name === 'settings') page = <SettingsPage />
  else page = <Home />

  return (
    <div className="app">
      {page}
      <UpdateBanner />
      {toast && (
        <div className="toast" key={toast.id}>
          {toast.emoji && <span className="toast__emoji">{toast.emoji}</span>}
          {toast.text}
        </div>
      )}
    </div>
  )
}
