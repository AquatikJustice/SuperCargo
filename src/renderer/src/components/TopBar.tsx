import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { useNarrow } from '../state/useViewport'
import { C, F, GLOW } from '../theme'
import { Btn } from './ui'
import Typeahead from './Typeahead'
import { shipCapacity } from '@shared/shipModules'
import { hasGridMarkup } from '@shared/cargoGrids'
import { DISCORD_URL } from '@shared/legal'

function useOutsideClose<T extends HTMLElement>(): {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  ref: React.MutableRefObject<T | null>
} {
  const [open, setOpen] = useState(false)
  const ref = useRef<T | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return { open, setOpen, ref }
}

const labelStyle: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: 11,
  letterSpacing: '0.2em',
  color: C.dim
}

export default function TopBar(): React.ReactElement {
  const openCapture = useStore((s) => s.openCapture)
  const openCompact = useStore((s) => s.openCompact)
  const closeCompact = useStore((s) => s.closeCompact)
  const compactOpen = useStore((s) => s.compactOpen)
  const appVersion = useStore((s) => s.appVersion)
  const reviewCount = useStore((s) => s.scanQueue.length)
  const openScanReview = useStore((s) => s.openScanReview)
  // stay compact up to the window's min width so the floor lands in the clean icon-only bar;
  // above it the full bar returns and the ship name ellipsizes if the wide layout is tight
  const narrow = useNarrow(960)

  return (
    <div
      className="drag"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 54,
        padding: '0 18px 0 22px',
        borderBottom: `1px solid ${C.line}`,
        flex: 'none',
        gap: 12
      }}
    >
      {/* left group yields and the ship name ellipsizes before anything can overlap the controls
          (no overflow:hidden here - it would clip the ship/run dropdowns) */}
      <div style={{ display: 'flex', alignItems: 'center', flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 'none' }}>
          <Logo />
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div
              style={{
                fontFamily: F.display,
                fontWeight: 600,
                fontSize: 17,
                letterSpacing: '0.14em',
                color: C.text,
                textShadow: GLOW,
                lineHeight: 1
              }}
            >
              SUPER<span style={{ color: C.acc }}>CARGO</span>
            </div>
            {appVersion && !narrow && (
              <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: '0.1em', color: C.faint, marginTop: 3 }}>
                v{appVersion}
              </div>
            )}
          </div>
        </div>
        {!narrow && <RunChip />}
        <ShipPicker narrow={narrow} />
      </div>

      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
        {reviewCount > 0 && <ReviewPill count={reviewCount} onClick={() => openScanReview()} />}
        <ChromeButton onClick={() => openCapture()} icon={<ScanIcon />} label="SCAN CONTRACT" compact={narrow} />
        <ChromeButton
          onClick={() => (compactOpen ? closeCompact() : openCompact())}
          icon={<CompactIcon active={compactOpen} />}
          label="OVERLAY"
          compact={narrow}
          active={compactOpen}
        />
        <DiscordLink />
        <WindowControls />
      </div>
    </div>
  )
}

function ReviewPill({ count, onClick }: { count: number; onClick: () => void }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      title="Review contracts found in your session"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        border: `1px solid ${C.acc}`,
        background: 'rgba(255,210,30,0.10)',
        padding: '5px 11px',
        cursor: 'pointer'
      }}
      hoverStyle={{ background: 'rgba(255,210,30,0.18)' }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.acc, boxShadow: GLOW }} />
      <span style={{ fontFamily: F.display, fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', color: C.acc }}>
        {count} TO REVIEW
      </span>
    </Btn>
  )
}

function RunChip(): React.ReactElement {
  const runId = useStore((s) => s.runId)
  const startNewRun = useStore((s) => s.startNewRun)
  const activeCount = useStore((s) => s.contracts.length)
  const { open, setOpen, ref } = useOutsideClose<HTMLDivElement>()
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!open) setConfirm(false)
  }, [open])

  return (
    <div ref={ref} className="no-drag" style={{ position: 'relative', marginLeft: 26, flex: 'none' }}>
      <Btn
        onClick={() => setOpen((o) => !o)}
        title="Start a new run"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          border: `1px solid ${open ? C.acc : 'transparent'}`,
          background: 'transparent',
          color: C.dim,
          fontFamily: F.mono,
          fontSize: 11,
          letterSpacing: '0.04em',
          padding: '5px 9px',
          cursor: 'pointer'
        }}
        hoverStyle={{ border: `1px solid ${C.acc}`, color: C.body }}
      >
        <span>
          RUN · <span style={{ color: C.body }}>{runId || '-'}</span>
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke={C.acc}
          strokeWidth="2.4"
          style={{ transform: open ? 'rotate(180deg)' : 'none', flex: 'none' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </Btn>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            minWidth: 256,
            background: '#05080a',
            border: `1px solid ${C.accBorder}`,
            boxShadow: '0 12px 34px rgba(0,0,0,0.6)',
            padding: 12,
            zIndex: 70
          }}
        >
          <div style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.2em', color: C.dim, marginBottom: 4 }}>
            CURRENT RUN
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 15, color: C.text, textShadow: GLOW, marginBottom: 12 }}>
            {runId || '-'}
          </div>
          <Btn
            onClick={() => {
              if (activeCount > 0 && !confirm) {
                setConfirm(true)
                return
              }
              startNewRun()
              setOpen(false)
            }}
            style={{
              width: '100%',
              justifyContent: 'center',
              border: `1px solid ${confirm ? C.red : C.acc}`,
              background: confirm ? 'rgba(236,116,112,0.14)' : C.accFill,
              color: C.text,
              textShadow: GLOW,
              fontFamily: F.display,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.14em',
              padding: '8px 12px',
              cursor: 'pointer'
            }}
            hoverStyle={{ background: confirm ? 'rgba(236,116,112,0.22)' : C.accFillStrong }}
          >
            {confirm ? 'CLEAR MANIFEST & START' : 'START NEW RUN'}
          </Btn>
          <p style={{ fontFamily: F.body, fontSize: 11, color: C.faint, lineHeight: 1.55, margin: '10px 0 0' }}>
            {activeCount > 0
              ? confirm
                ? 'Clears the manifest. Turned-in contracts file to History first.'
                : `Clears the ${activeCount} contract${activeCount === 1 ? '' : 's'} and starts fresh.`
              : 'Also auto-starts when you accept into an empty manifest.'}
          </p>
        </div>
      )}
    </div>
  )
}

function ShipPicker({ narrow }: { narrow?: boolean }): React.ReactElement {
  const shipName = useStore((s) => s.settings.activeShip)
  const installedModules = useStore((s) => s.settings.installedModules)
  const ships = useStore((s) => s.ships)
  const gridFacesSyncedAt = useStore((s) => s.gridFacesSyncedAt)
  const updateSettings = useStore((s) => s.updateSettings)
  const { open, setOpen, ref } = useOutsideClose<HTMLDivElement>()
  const shipNames = useMemo(() => ships.map((s) => s.name), [ships])
  // recompute when markup syncs
  const needsGrid = useMemo(() => (name: string) => !hasGridMarkup(name), [gridFacesSyncedAt])
  const activeNeedsGrid = needsGrid(shipName)
  const ship = ships.find((s) => s.name === shipName)
  const scu = shipCapacity(ship, installedModules[shipName])
  const modules = ship?.modules ?? []
  const installed = installedModules[shipName] ?? modules.map((m) => m.id)

  const toggleModule = (id: string): void => {
    if (!ship?.modules) return
    const next = installed.includes(id) ? installed.filter((x) => x !== id) : [...installed, id]
    void updateSettings({ installedModules: { ...installedModules, [shipName]: next } })
  }

  return (
    <div
      ref={ref}
      className="no-drag"
      style={{ display: 'flex', alignItems: 'center', gap: 9, marginLeft: narrow ? 14 : 26, position: 'relative', minWidth: 0 }}
    >
      {!narrow && <span style={labelStyle}>SHIP</span>}
      <Btn
        onClick={() => setOpen((o) => !o)}
        title="Change active ship / cargo modules"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          border: `1px solid ${open ? C.acc : 'rgba(255,255,255,0.16)'}`,
          background: 'transparent',
          color: C.text,
          fontFamily: F.body,
          fontSize: 14,
          padding: '5px 11px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          minWidth: 0,
          overflow: 'hidden'
        }}
        hoverStyle={{ border: `1px solid ${C.acc}`, textShadow: GLOW }}
      >
        {activeNeedsGrid && (
          <span title="Cargo grid not mapped for loading yet" style={{ color: '#e8b13a', fontSize: 13, lineHeight: 1, flex: 'none' }}>
            ⚠
          </span>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{shipName}</span>
        {!narrow && <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim, flex: 'none' }}>{scu} SCU</span>}
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke={C.acc}
          strokeWidth="2.4"
          style={{ transform: open ? 'rotate(180deg)' : 'none', flex: 'none' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </Btn>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            minWidth: 300,
            background: '#05080a',
            border: `1px solid ${C.accBorder}`,
            boxShadow: '0 12px 34px rgba(0,0,0,0.6)',
            padding: 12,
            zIndex: 70
          }}
        >
          <Typeahead
            value={shipName}
            options={shipNames}
            freeText={false}
            maxResults={12}
            autoFocus
            clearOnFocus
            search
            warn={needsGrid}
            warnTitle="Cargo grid not mapped for loading yet"
            onSelect={(name) => void updateSettings({ activeShip: name })}
            placeholder="Search ships..."
          />

          {modules.length > 0 && (
            <div style={{ marginTop: 14, borderTop: `1px solid ${C.lineStrong}`, paddingTop: 12 }}>
              <div style={{ ...labelStyle, fontSize: 10, marginBottom: 9 }}>CARGO MODULES FITTED</div>
              {modules.map((m) => {
                const on = installed.includes(m.id)
                return (
                  <Btn
                    key={m.id}
                    onClick={() => toggleModule(m.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      border: 0,
                      background: 'transparent',
                      cursor: 'pointer',
                      padding: '5px 0'
                    }}
                    hoverStyle={{}}
                  >
                    <Switch on={on} />
                    <span style={{ fontFamily: F.body, fontSize: 13, color: on ? C.text : C.dim, flex: 1, textAlign: 'left' }}>
                      {m.name}
                    </span>
                    <span style={{ fontFamily: F.mono, fontSize: 12, color: on ? C.acc : C.faint }}>+{m.scu}</span>
                  </Btn>
                )
              })}
              <div style={{ fontFamily: F.mono, fontSize: 11, color: C.dim, marginTop: 8 }}>
                Hull {ship?.baseScu ?? 0} + modules = <span style={{ color: C.text }}>{scu} SCU</span>
              </div>
            </div>
          )}
        </div>
      )}

      {activeNeedsGrid && !narrow && (
        <span
          title="Pick a ship without the ⚠ for an accurate layout"
          style={{ flex: '0 1 auto', minWidth: 0, marginLeft: 4, fontFamily: F.body, fontSize: 12, color: '#e8b13a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          Cargo grid not mapped for loading yet
        </span>
      )}
    </div>
  )
}

function Switch({ on }: { on: boolean }): React.ReactElement {
  return (
    <span
      style={{
        width: 32,
        height: 16,
        flex: 'none',
        background: on ? C.acc : 'rgba(255,255,255,0.16)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: on ? 'flex-end' : 'flex-start',
        padding: 2
      }}
    >
      <span style={{ width: 12, height: 12, background: '#000' }} />
    </span>
  )
}

function ChromeButton({
  onClick,
  icon,
  label,
  compact,
  active
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  compact?: boolean
  active?: boolean
}): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      title={compact ? label : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        border: `1px solid ${active ? C.green : 'rgba(255,255,255,0.18)'}`,
        background: active ? 'rgba(95,208,137,0.1)' : 'transparent',
        color: active ? C.text : C.body,
        fontFamily: F.display,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.14em',
        padding: compact ? '8px 10px' : '8px 14px',
        cursor: 'pointer'
      }}
      hoverStyle={{ border: `1px solid ${active ? C.green : C.acc}`, color: C.text, textShadow: GLOW }}
    >
      {icon}
      {!compact && label}
    </Btn>
  )
}

function WindowControls(): React.ReactElement {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.supercargo.isMaximized().then(setMaximized)
    return window.supercargo.onWindowState((s) => setMaximized(s.maximized))
  }, [])

  const ctrl = (action: 'minimize' | 'maximize' | 'close'): void => {
    void window.supercargo.windowControl(action)
  }
  const base: React.CSSProperties = {
    border: 0,
    background: 'transparent',
    color: C.dim,
    width: 30,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
  }
  return (
    <div style={{ display: 'flex', marginLeft: 4 }}>
      <Btn onClick={() => ctrl('minimize')} style={base} hoverStyle={{ color: C.text }} title="Minimize">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </Btn>
      <Btn
        onClick={() => ctrl('maximize')}
        style={base}
        hoverStyle={{ color: C.text }}
        title={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="8" y="3" width="13" height="13" />
            <path d="M3 8v11a2 2 0 0 0 2 2h11" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="5" width="14" height="14" />
          </svg>
        )}
      </Btn>
      <Btn
        onClick={() => ctrl('close')}
        style={base}
        hoverStyle={{ color: C.red }}
        title="Close"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </Btn>
    </div>
  )
}

function ScanIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="7" y1="12" x2="17" y2="12" />
    </svg>
  )
}

function CompactIcon({ active }: { active?: boolean }): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
      {active && <rect x="8" y="8" width="8" height="8" rx="1.5" fill={C.green} stroke="none" />}
    </svg>
  )
}

function DiscordLink(): React.ReactElement {
  const [hover, setHover] = useState(false)
  return (
    <a
      href={DISCORD_URL}
      title="Join the community on Discord"
      className="no-drag"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 28,
        color: hover ? C.acc : C.body,
        cursor: 'pointer'
      }}
    >
      <DiscordIcon />
    </a>
  )
}

function DiscordIcon(): React.ReactElement {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.073.073 0 0 0-.078.037c-.21.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.076.076 0 0 0-.079-.036A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.197.373.291a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  )
}

function Logo(): React.ReactElement {
  const scu = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '26.1',
    fontWeight: 700,
    letterSpacing: '1.5',
    stroke: 'none',
    textAnchor: 'middle' as const,
    dominantBaseline: 'central' as const
  }
  return (
    <svg viewBox="-44 -472 548 516" width="34" height="32" style={{ display: 'block', flex: 'none' }}>
      <g stroke="#1c1f25" strokeWidth="5.5" strokeLinejoin="round">
        <polygon points="150,0 150,-150 310,-278 310,-128" fill="#4d545c" />
        <polygon points="0,-150 150,-150 310,-278 160,-278" fill="#717880" />
        <polygon points="0,0 150,0 150,-150 0,-150" fill="#8e949c" />
        <rect x="25.5" y="-97.5" width="99" height="43.5" rx="21.8" fill="none" stroke="#ff9c30" strokeWidth="9" />
        <text x="75" y="-75.8" fill="#ff9c30" {...scu}>SCU</text>
      </g>
      <g stroke="#1c1f25" strokeWidth="5.5" strokeLinejoin="round">
        <polygon points="300,0 300,-150 460,-278 460,-128" fill="#4d545c" />
        <polygon points="150,-150 300,-150 460,-278 310,-278" fill="#717880" />
        <polygon points="150,0 300,0 300,-150 150,-150" fill="#8e949c" />
        <rect x="175.5" y="-97.5" width="99" height="43.5" rx="21.8" fill="none" stroke="#ff9c30" strokeWidth="9" />
        <text x="225" y="-75.8" fill="#ff9c30" {...scu}>SCU</text>
      </g>
      <g stroke="#1c1f25" strokeWidth="5.5" strokeLinejoin="round">
        <polygon points="150,-150 150,-300 310,-428 310,-278" fill="#4d545c" />
        <polygon points="0,-300 150,-300 310,-428 160,-428" fill="#717880" />
        <polygon points="0,-150 150,-150 150,-300 0,-300" fill="#8e949c" />
        <rect x="25.5" y="-247.5" width="99" height="43.5" rx="21.8" fill="none" stroke="#ff9c30" strokeWidth="9" />
        <text x="75" y="-225.8" fill="#ff9c30" {...scu}>SCU</text>
      </g>
      <g>
        <polygon points="300,-150 300,-300 460,-428 460,-278" fill="#7c74c8" fillOpacity="0.30" />
        <polygon points="150,-300 300,-300 460,-428 310,-428" fill="#7c74c8" fillOpacity="0.42" />
        <polygon points="150,-150 300,-150 300,-300 150,-300" fill="#7c74c8" fillOpacity="0.54" />
        <polygon points="300,-150 300,-300 460,-428 460,-278" fill="none" stroke="#bdb2f2" strokeWidth="7" strokeLinejoin="round" />
        <polygon points="150,-300 300,-300 460,-428 310,-428" fill="none" stroke="#bdb2f2" strokeWidth="7" strokeLinejoin="round" />
        <polygon points="150,-150 300,-150 300,-300 150,-300" fill="none" stroke="#bdb2f2" strokeWidth="7" strokeLinejoin="round" />
        <rect x="175.5" y="-247.5" width="99" height="43.5" rx="21.8" fill="none" stroke="#bdb2f2" strokeWidth="6.5" opacity="0.85" />
        <text x="225" y="-225.8" fill="#bdb2f2" opacity="0.85" {...scu}>SCU</text>
      </g>
    </svg>
  )
}
