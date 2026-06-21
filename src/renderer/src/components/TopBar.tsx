import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW } from '../theme'
import { Btn } from './ui'
import Typeahead from './Typeahead'
import { shipCapacity } from '@shared/shipModules'

const labelStyle: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: 11,
  letterSpacing: '0.2em',
  color: C.dim
}

export default function TopBar(): React.ReactElement {
  const openCapture = useStore((s) => s.openCapture)
  const openCompact = useStore((s) => s.openCompact)
  const appVersion = useStore((s) => s.appVersion)

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
        flex: 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
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
            {appVersion && (
              <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: '0.1em', color: C.faint, marginTop: 3 }}>
                v{appVersion}
              </div>
            )}
          </div>
        </div>
        <RunChip />
        <ShipPicker />
      </div>

      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ChromeButton onClick={() => openCapture()} icon={<ScanIcon />} label="SCAN CONTRACT" />
        <ChromeButton onClick={openCompact} icon={<CompactIcon />} label="COMPACT" />
        <WindowControls />
      </div>
    </div>
  )
}

function RunChip(): React.ReactElement {
  const runId = useStore((s) => s.runId)
  const startNewRun = useStore((s) => s.startNewRun)
  const activeCount = useStore((s) => s.contracts.length)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} className="no-drag" style={{ position: 'relative', marginLeft: 26 }}>
      <Btn
        onClick={() => setOpen((o) => !o)}
        title="Current run - start a new one"
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
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
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
              startNewRun()
              setOpen(false)
            }}
            style={{
              width: '100%',
              justifyContent: 'center',
              border: `1px solid ${C.acc}`,
              background: C.accFill,
              color: C.text,
              textShadow: GLOW,
              fontFamily: F.display,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.14em',
              padding: '8px 12px',
              cursor: 'pointer'
            }}
            hoverStyle={{ background: C.accFillStrong }}
          >
            START NEW RUN
          </Btn>
          <p style={{ fontFamily: F.body, fontSize: 11, color: C.faint, lineHeight: 1.55, margin: '10px 0 0' }}>
            {activeCount > 0
              ? `${activeCount} contract${activeCount === 1 ? '' : 's'} on the manifest will finish under this run. A new run also starts on its own once the manifest is empty.`
              : 'A new run also starts on its own when you accept a contract with an empty manifest.'}
          </p>
        </div>
      )}
    </div>
  )
}

function ShipPicker(): React.ReactElement {
  const shipName = useStore((s) => s.settings.activeShip)
  const installedModules = useStore((s) => s.settings.installedModules)
  const ships = useStore((s) => s.ships)
  const updateSettings = useStore((s) => s.updateSettings)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const shipNames = useMemo(() => ships.map((s) => s.name), [ships])
  const ship = ships.find((s) => s.name === shipName)
  const scu = shipCapacity(ship, installedModules[shipName])
  const modules = ship?.modules ?? []
  const installed = installedModules[shipName] ?? modules.map((m) => m.id)

  // Close the popover on any click outside it.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const toggleModule = (id: string): void => {
    if (!ship?.modules) return
    const next = installed.includes(id) ? installed.filter((x) => x !== id) : [...installed, id]
    void updateSettings({ installedModules: { ...installedModules, [shipName]: next } })
  }

  return (
    <div
      ref={ref}
      className="no-drag"
      style={{ display: 'flex', alignItems: 'center', gap: 9, marginLeft: 26, position: 'relative' }}
    >
      <span style={labelStyle}>SHIP</span>
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
          whiteSpace: 'nowrap'
        }}
        hoverStyle={{ border: `1px solid ${C.acc}`, textShadow: GLOW }}
      >
        <span>{shipName}</span>
        <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>{scu} SCU</span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke={C.acc}
          strokeWidth="2.4"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
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
          <div style={{ ...labelStyle, fontSize: 10, marginBottom: 8 }}>ACTIVE SHIP</div>
          <Typeahead
            value={shipName}
            options={shipNames}
            freeText={false}
            maxResults={12}
            autoFocus
            onSelect={(name) => void updateSettings({ activeShip: name })}
            placeholder="Type to find a ship..."
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
  label
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
}): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        border: `1px solid rgba(255,255,255,0.18)`,
        background: 'transparent',
        color: C.body,
        fontFamily: F.display,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.14em',
        padding: '8px 14px',
        cursor: 'pointer'
      }}
      hoverStyle={{ border: `1px solid ${C.acc}`, color: C.text, textShadow: GLOW }}
    >
      {icon}
      {label}
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
          // Restore: two offset squares
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

function CompactIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

function Logo(): React.ReactElement {
  // Isometric stacked-cargo mark from the design comp: three solid SCU crates
  // stacked into an L, with a translucent purple "ghost" crate (light outline,
  // the snap target) filling the open top slot to complete the square.
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
