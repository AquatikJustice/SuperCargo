import React, { useEffect } from 'react'
import { useStore } from './state/store'
import { C, ZOOM_STEP, ZOOM_DEFAULT, clampZoom } from './theme'
import TopBar from './components/TopBar'
import BottomNav from './components/BottomNav'
import ManifestPage from './pages/ManifestPage'
import ContractsPage from './pages/ContractsPage'
import CargoGridPage from './pages/CargoGridPage'
import HistoryPage from './pages/HistoryPage'
import SettingsPage from './pages/SettingsPage'
import CaptureModal from './components/CaptureModal'
import CompactWindowApp from './components/CompactWindowApp'
import Onboarding from './components/Onboarding'
import UpdateBanner from './components/UpdateBanner'

// The compact overlay is a separate always-on-top window that loads this same
// bundle with the URL hash #compact. There we render just the card, no app chrome.
const IS_COMPACT = typeof window !== 'undefined' && window.location.hash.replace('#', '') === 'compact'

export default function App(): React.ReactElement {
  if (IS_COMPACT) return <CompactWindowApp />
  return <MainApp />
}

function MainApp(): React.ReactElement {
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view)
  const init = useStore((s) => s.init)
  const uiZoom = useStore((s) => s.settings.uiZoom)
  const onboarded = useStore((s) => s.settings.onboarded)
  const updateSettings = useStore((s) => s.updateSettings)

  useEffect(() => {
    void init()
  }, [init])

  // Apply the saved zoom (text and layout scale) whenever it changes.
  useEffect(() => {
    window.supercargo.setZoom(uiZoom || 1)
  }, [uiZoom])

  // Ctrl/Cmd with +, -, or 0 to grow, shrink, or reset the text size.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        void updateSettings({ uiZoom: clampZoom((uiZoom || 1) + ZOOM_STEP) })
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        void updateSettings({ uiZoom: clampZoom((uiZoom || 1) - ZOOM_STEP) })
      } else if (e.key === '0') {
        e.preventDefault()
        void updateSettings({ uiZoom: ZOOM_DEFAULT })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [uiZoom, updateSettings])

  return (
    <div
      style={{
        // In-game tablet bezel: accent outline flush to the window edge so the OS
        // resize cursor lands right on it. Rounded like a tablet. No outer glow (it
        // pushed the apparent edge inward); a faint inner wash keeps the holo feel.
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: C.black,
        color: C.textBody,
        overflow: 'hidden',
        border: '2px solid rgba(255,210,30,0.6)',
        borderRadius: 18,
        boxShadow: 'inset 0 0 48px rgba(255,210,30,0.05)'
      }}
    >
      <TopBar />
      <UpdateBanner />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {!ready ? (
          <Loading />
        ) : (
          <>
            {view === 'manifest' && <ManifestPage />}
            {view === 'contracts' && <ContractsPage />}
            {view === 'grid' && <CargoGridPage />}
            {view === 'history' && <HistoryPage />}
            {view === 'settings' && <SettingsPage />}
          </>
        )}
      </div>
      <BottomNav />
      <CaptureModal />
      {ready && !onboarded && <Onboarding />}
    </div>
  )
}

function Loading(): React.ReactElement {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Rajdhani', sans-serif",
        letterSpacing: '0.2em',
        color: C.faint,
        fontSize: 13
      }}
    >
      INITIALIZING...
    </div>
  )
}
