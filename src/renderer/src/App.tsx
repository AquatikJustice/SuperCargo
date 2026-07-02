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
import ScanReviewModal from './components/ScanReviewModal'
import CompactWindowApp from './components/CompactWindowApp'
import Onboarding from './components/Onboarding'
import UpdateBanner from './components/UpdateBanner'

// overlay window loads this bundle at #compact
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

  useEffect(() => {
    window.supercargo.setZoom(uiZoom || 1)
  }, [uiZoom])

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
        // no outer glow, it shifts the apparent edge inward
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: C.black,
        color: C.textBody,
        overflow: 'hidden',
        border: '2px solid rgba(255,210,30,0.6)',
        // no glow box-shadow here: a blurred shadow on the full window re-rasterizes every
        // resize frame, which makes dragging the edges crawl (see global.css perf note)
        borderRadius: 18
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
      <ScanReviewModal />
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
