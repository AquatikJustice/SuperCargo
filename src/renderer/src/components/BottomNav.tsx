import React, { useState } from 'react'
import { useStore, type ViewId } from '../state/store'
import { useNarrow } from '../state/useViewport'
import { C, F } from '../theme'
import { Btn } from './ui'
import { MADE_BY_COMMUNITY } from '@shared/legal'

const NAV: Array<{ id: ViewId; label: string }> = [
  { id: 'manifest', label: 'MANIFEST' },
  { id: 'contracts', label: 'CONTRACTS' },
  { id: 'grid', label: 'CARGO GRID' },
  { id: 'history', label: 'HISTORY' },
  { id: 'settings', label: 'SETTINGS' }
]

export default function BottomNav(): React.ReactElement {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  // below this, panels crowd out the tabs
  const narrow = useNarrow(820)

  return (
    <div style={{ display: 'flex', height: 70, borderTop: `1px solid ${C.line}`, flex: 'none' }}>
      {NAV.map((item) => {
        const active = view === item.id
        return (
          <Btn
            key={item.id}
            onClick={() => setView(item.id)}
            style={{
              flex: 1,
              border: 0,
              borderTop: `2px solid ${active ? C.acc : 'transparent'}`,
              borderRight: `1px solid ${C.lineFaint}`,
              background: active ? 'rgba(255,210,30,0.07)' : 'transparent',
              color: active ? C.text : C.ghost,
              textShadow: active ? '0 0 7px rgba(255,210,30,0.45)' : 'none',
              fontFamily: F.display,
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '0.18em',
              cursor: 'pointer'
            }}
            hoverStyle={active ? {} : { color: '#d4d8d9', background: 'rgba(255,255,255,0.025)' }}
          >
            {item.label}
          </Btn>
        )
      })}
      {!narrow && <WatcherStatusPanel />}
      {!narrow && <AttributionPanel />}
    </div>
  )
}

const FOOTER_H = 70

function AttributionPanel(): React.ReactElement {
  // hover slides badge up, reveals trademark
  const [logoOk, setLogoOk] = useState(true)
  const [hover, setHover] = useState(false)
  const row: React.CSSProperties = {
    height: FOOTER_H,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 22
  }
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: '0 0 auto',
        width: 196,
        height: '100%',
        overflow: 'hidden',
        borderLeft: `1px solid ${C.lineFaint}`,
        cursor: 'default'
      }}
    >
      <div
        style={{
          transform: hover ? `translateY(${-FOOTER_H}px)` : 'translateY(0)',
          transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)'
        }}
      >
        <div style={row}>
          {logoOk && (
            <img
              src="./made-by-community.png"
              alt={MADE_BY_COMMUNITY}
              onError={() => setLogoOk(false)}
              style={{ height: 50, width: 'auto', opacity: 0.95 }}
            />
          )}
        </div>
        <div style={{ ...row, flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', textAlign: 'right' }}>
          <div style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.16em', color: C.acc }}>
            UNOFFICIAL FAN TOOL
          </div>
          <div style={{ fontFamily: F.body, fontSize: 10.5, lineHeight: 1.4, color: C.faint, marginTop: 3 }}>
            Star Citizen® is a trademark of
            <br />
            Cloud Imperium Games · not affiliated
          </div>
        </div>
      </div>
    </div>
  )
}

function WatcherStatusPanel(): React.ReactElement {
  const watcher = useStore((s) => s.watcher)
  const connected = watcher.connected
  const color = connected ? C.green : C.amber
  const label = connected ? 'CONNECTED' : watcher.path ? 'WAITING' : 'NO LOG PATH'

  return (
    <div
      style={{
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 22px',
        background: 'rgba(255,255,255,0.015)'
      }}
      title={watcher.path ?? 'Set the Game.log path in Settings'}
    >
      <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.dim, marginBottom: 5 }}>
        LOG WATCHER
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flex: 'none' }} />
        <span style={{ fontFamily: F.mono, fontSize: 13, color, letterSpacing: '0.04em' }}>{label}</span>
      </div>
    </div>
  )
}
