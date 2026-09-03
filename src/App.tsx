import { useEffect } from 'react'
import { useStore } from './store'
import { useRoute } from './router'
import LockScreen from './pages/LockScreen'
import Home from './pages/Home'
import ProjectPage from './pages/ProjectPage'
import SettingsPage from './pages/SettingsPage'
import Onboarding from './pages/Onboarding'
import TripPage from './pages/TripPage'
import JoinTripPage from './pages/JoinTripPage'
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
  const prefs = useStore((s) => s.prefs)
  const setPrefs = useStore((s) => s.setPrefs)
  const isFresh = useStore((s) => s.data.me.name === '我' && s.data.projects.length === 0)
  const tutorial = useStore((s) => s.tutorialOpen)
  const setTutorial = useStore((s) => s.setTutorialOpen)
  const route = useRoute()
  useTheme()
  useAutoLock()
  useEffect(() => {
    init()
  }, [init])
  // 第一次用（還沒取名、沒帳本）就進教學；一旦進去就走完，不會因為中途填了名字而消失
  useEffect(() => {
    if (ready && !locked && !prefs.onboarded && isFresh) setTutorial(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, locked])

  if (!ready) {
    return (
      <div className="splash">
        <Mascot size={96} className="mascot--float" />
        <div className="splash__name">반반</div>
      </div>
    )
  }
  if (locked) return <LockScreen />
  if (tutorial) {
    return (
      <Onboarding
        onDone={() => {
          setPrefs({ onboarded: true })
          setTutorial(false)
        }}
      />
    )
  }

  let page
  if (route.name === 'project') page = <ProjectPage id={route.id} tab={route.tab ?? 'items'} />
  else if (route.name === 'settings') page = <SettingsPage />
  else if (route.name === 'trip') page = <TripPage id={route.id} />
  else if (route.name === 'join') page = <JoinTripPage id={route.id} secret={route.key} />
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
