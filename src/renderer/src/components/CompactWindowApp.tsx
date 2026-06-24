import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW } from '../theme'
import { deriveStops } from '../state/manifest'
import { Btn } from './ui'

// compact always-on-top window (#compact)
const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties
const NODRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export default function CompactWindowApp(): React.ReactElement {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const contracts = useStore((s) => s.contracts)
  const order = useStore((s) => s.order)
  const setObjectivesDelivered = useStore((s) => s.setObjectivesDelivered)
  const closeCompact = useStore((s) => s.closeCompact)

  useEffect(() => {
    void init()
  }, [init])

  const stops = useMemo(
    () => deriveStops(contracts, order).filter((s) => s.items.some((i) => !i.delivered)),
    [contracts, order]
  )
  const [idx, setIdx] = useState(0)
  const safeIdx = Math.min(idx, Math.max(0, stops.length - 1))
  const stop = stops[safeIdx]

  const markDelivered = (): void => {
    if (!stop) return
    setObjectivesDelivered(
      stop.items.filter((i) => !i.delivered).map((i) => ({ contractId: i.contractId, objectiveId: i.objectiveId })),
      true
    )
    // keep idx so next stop shows
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: C.black,
        border: `1px solid ${C.accBorder}`,
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: F.body,
        boxShadow: '0 0 12px rgba(255,210,30,0.35)'
      }}
    >
      <div
        style={{
          ...DRAG,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '9px 12px',
          borderBottom: `1px solid ${C.lineStrong}`,
          cursor: 'move'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.acc }}>NEXT STOP</span>
          {stops.length > 0 && (
            <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>
              {safeIdx + 1} / {stops.length}
            </span>
          )}
        </div>
        <Btn
          onClick={closeCompact}
          style={{ ...NODRAG, border: 0, background: 'transparent', color: C.dim, cursor: 'pointer', display: 'flex', padding: 2 }}
          hoverStyle={{ color: C.text }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </Btn>
      </div>

      {!ready ? (
        <Filler text="..." />
      ) : !stop ? (
        <Filler text="No active stops. Add a contract to see the next delivery here." />
      ) : (
        <>
          <div style={{ padding: '12px 14px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontFamily: F.mono, fontSize: 22, fontWeight: 600, color: C.text, textShadow: GLOW }}>{stop.n}</span>
              <div>
                {stop.code && <div style={{ fontFamily: F.mono, fontSize: 11, color: C.acc }}>{stop.code}</div>}
                <div style={{ fontFamily: F.display, fontSize: 15, fontWeight: 600, color: C.text, textShadow: GLOW, letterSpacing: '0.03em' }}>
                  {stop.name}
                </div>
              </div>
            </div>
            {stop.hasElevator !== undefined && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: stop.hasElevator ? C.green : C.amber }} />
                <span style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.16em', color: stop.hasElevator ? C.green : C.amber }}>
                  {stop.hasElevator ? 'FREIGHT ELEVATOR' : 'NO ELEVATOR · FRONT RAMP'}
                </span>
              </div>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 14px 10px' }}>
            {stop.items.map((item) => (
              <div key={item.objectiveId} style={{ padding: '9px 0', borderTop: `1px solid rgba(255,255,255,0.07)`, opacity: item.delivered ? 0.45 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: F.body, fontSize: 14, color: C.textBody }}>{item.commodity}</span>
                  <span style={{ fontFamily: F.mono, fontSize: 14, color: C.text, textShadow: GLOW }}>{item.scu} SCU</span>
                </div>
                <div style={{ fontFamily: F.mono, fontSize: 12, color: '#b6bec0', marginTop: 3 }}>
                  <span style={{ color: C.faint }}>· </span>
                  {item.boxStr || '-'}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, padding: '0 12px 12px' }}>
            <Btn
              onClick={() => setIdx(Math.max(0, safeIdx - 1))}
              disabled={safeIdx === 0}
              style={{ ...NODRAG, border: `1px solid ${C.lineStrong}`, background: 'transparent', color: safeIdx === 0 ? C.ghost : C.dim, cursor: safeIdx === 0 ? 'default' : 'pointer', padding: '10px 12px', fontFamily: F.display, fontSize: 16, lineHeight: 1 }}
              hoverStyle={safeIdx === 0 ? {} : { color: C.text }}
            >
              ‹
            </Btn>
            <Btn
              onClick={markDelivered}
              style={{ ...NODRAG, flex: 1, border: `1px solid ${C.acc}`, background: C.accFill, color: C.text, textShadow: GLOW, fontFamily: F.display, fontSize: 13, fontWeight: 600, letterSpacing: '0.16em', padding: 11, cursor: 'pointer' }}
              hoverStyle={{ background: C.accFillStrong }}
            >
              MARK DELIVERED
            </Btn>
            <Btn
              onClick={() => setIdx(Math.min(stops.length - 1, safeIdx + 1))}
              disabled={safeIdx >= stops.length - 1}
              style={{ ...NODRAG, border: `1px solid ${C.lineStrong}`, background: 'transparent', color: safeIdx >= stops.length - 1 ? C.ghost : C.dim, cursor: safeIdx >= stops.length - 1 ? 'default' : 'pointer', padding: '10px 12px', fontFamily: F.display, fontSize: 16, lineHeight: 1 }}
              hoverStyle={safeIdx >= stops.length - 1 ? {} : { color: C.text }}
            >
              ›
            </Btn>
          </div>
        </>
      )}
    </div>
  )
}

function Filler({ text }: { text: string }): React.ReactElement {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, textAlign: 'center', fontFamily: F.body, fontSize: 13, color: C.dim }}>
      {text}
    </div>
  )
}
