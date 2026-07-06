import React, { useState } from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW } from '../theme'
import { MAX_BOX_OPTIONS, calculateBoxes, boxCount, boxBreakdown } from '@shared/box'
import type { ScannedContract } from '@shared/types'
import { Btn } from './ui'

const labelStyle: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: 11,
  letterSpacing: '0.2em',
  color: C.dim,
  marginBottom: 7
}

export default function ScanReviewModal(): React.ReactElement | null {
  const open = useStore((s) => s.scanReviewOpen)
  const captureOpen = useStore((s) => s.captureOpen)
  const queue = useStore((s) => s.scanQueue)

  // capture takes over the screen; come back to the queue after
  if (!open || captureOpen || !queue.length) return null

  const current = queue[0]
  return (
    <div
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 50 }}
    >
      <div style={{ width: 620, maxWidth: '100%', maxHeight: '100%', overflowY: 'auto', background: C.black, border: `1px solid rgba(255,255,255,0.22)`, fontFamily: F.body }}>
        <Header remaining={queue.length} />
        <ItemCard key={current.accepted.missionId} item={current} />
      </div>
    </div>
  )
}

function Header({ remaining }: { remaining: number }): React.ReactElement {
  const close = useStore((s) => s.closeScanReview)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.lineStrong}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.acc} strokeWidth="1.6">
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
          <line x1="7" y1="12" x2="17" y2="12" />
        </svg>
        <div>
          <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600, letterSpacing: '0.08em', color: C.text, textShadow: GLOW }}>
            REVIEW ACTIVE CONTRACTS
          </div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>
            Found in your session. Add the cargo details yourself.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 'none' }}>
        <span style={{ fontFamily: F.mono, fontSize: 12, color: C.acc }}>{remaining} left</span>
        <Btn
          onClick={close}
          title="Close (they'll be waiting under the review badge)"
          style={{ border: 0, background: 'transparent', color: C.dim, cursor: 'pointer', display: 'flex', padding: 4 }}
          hoverStyle={{ color: C.text }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </Btn>
      </div>
    </div>
  )
}

function ItemCard({ item }: { item: ScannedContract }): React.ReactElement {
  const addScanItem = useStore((s) => s.addScanItem)
  const scanItemDetails = useStore((s) => s.scanItemDetails)
  const skipScanItem = useStore((s) => s.skipScanItem)
  const dismissScanItem = useStore((s) => s.dismissScanItem)
  const [maxBox, setMaxBox] = useState(16)

  const missionId = item.accepted.missionId
  const objectives = item.objectives
  const hasObjectives = objectives.length > 0
  const title = item.accepted.title || 'Hauling contract'

  return (
    <div style={{ padding: '18px 20px' }}>
      <div style={{ fontFamily: F.display, fontSize: 15, letterSpacing: '0.04em', color: C.text, marginBottom: 4 }}>
        {title}
      </div>
      {item.accepted.pickup && (
        <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginBottom: 16 }}>
          Pickup · {item.accepted.pickup}
        </div>
      )}

      {hasObjectives ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 1.3fr 70px', gap: 12, padding: '0 0 8px', borderBottom: `1px solid ${C.lineStrong}` }}>
            {['COMMODITY', 'SCU', 'DESTINATION', 'BOXES'].map((h, i) => (
              <span key={h} style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.18em', color: C.faint, textAlign: i === 1 || i === 3 ? 'right' : 'left' }}>
                {h}
              </span>
            ))}
          </div>
          {objectives.map((o, i) => {
            const boxes = calculateBoxes(o.scuAmount, maxBox)
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 1.3fr 70px', gap: 12, padding: '9px 0', borderBottom: `1px solid ${C.lineSoft}`, alignItems: 'center' }}>
                <span style={{ fontFamily: F.body, fontSize: 13, color: C.body }}>{o.commodity}</span>
                <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body, textAlign: 'right' }}>{o.scuAmount}</span>
                <span style={{ fontFamily: F.body, fontSize: 13, color: C.body }}>{o.destination}</span>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim, textAlign: 'right' }} title={boxBreakdown(boxes)}>
                  {boxCount(boxes)} box
                </span>
              </div>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <span style={labelStyle}>BOX SIZE</span>
            <select
              value={maxBox}
              onChange={(e) => setMaxBox(Number(e.target.value))}
              style={{ background: 'transparent', border: 0, borderBottom: `1px solid rgba(255,255,255,0.2)`, color: C.text, fontFamily: F.body, fontSize: 13, padding: '5px 0', outline: 'none', cursor: 'pointer', appearance: 'none' }}
            >
              {MAX_BOX_OPTIONS.map((s) => (
                <option key={s} value={s} style={{ background: '#0a0c0d' }}>
                  {s} SCU
                </option>
              ))}
            </select>
            <span style={{ fontFamily: F.body, fontSize: 11, color: C.faint }}>the log doesn&apos;t record it</span>
          </div>
        </>
      ) : (
        <div style={{ fontFamily: F.body, fontSize: 13, color: C.dim, lineHeight: 1.5, padding: '10px 0', borderTop: `1px solid ${C.lineSoft}`, borderBottom: `1px solid ${C.lineSoft}` }}>
          No objectives logged yet. Pull it up on your mobiGlas and scan the details.
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {hasObjectives && (
          <PrimaryBtn onClick={() => addScanItem(missionId, maxBox)}>ADD IT</PrimaryBtn>
        )}
        <PrimaryBtn onClick={() => scanItemDetails(missionId)} ghost={hasObjectives}>
          SCAN DETAILS
        </PrimaryBtn>
        <span style={{ flex: 1 }} />
        <PlainBtn onClick={() => skipScanItem(missionId)}>SKIP FOR NOW</PlainBtn>
        <PlainBtn onClick={() => dismissScanItem(missionId)} danger>
          DISCARD
        </PlainBtn>
      </div>
    </div>
  )
}

function PrimaryBtn({ onClick, ghost, children }: { onClick: () => void; ghost?: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{
        border: `1px solid ${C.acc}`,
        background: ghost ? 'transparent' : C.accFillStrong,
        color: C.text,
        textShadow: GLOW,
        fontFamily: F.display,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.14em',
        padding: '9px 18px',
        cursor: 'pointer'
      }}
      hoverStyle={{ background: C.accFill }}
    >
      {children}
    </Btn>
  )
}

function PlainBtn({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{
        border: `1px solid rgba(255,255,255,0.18)`,
        background: 'transparent',
        color: C.body,
        fontFamily: F.display,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.14em',
        padding: '9px 18px',
        cursor: 'pointer'
      }}
      hoverStyle={{ border: `1px solid ${danger ? C.red : '#fff'}`, color: danger ? C.red : C.text }}
    >
      {children}
    </Btn>
  )
}
