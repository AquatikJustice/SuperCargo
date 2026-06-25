import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { C, F } from '../theme'
import { buildLoadingSteps, type LoadingStep } from '../state/loading'
import { splitDestination } from '../data/stations'
import { Btn } from './ui'

// always-on-top overlay (#compact), styled after the in-game contract tracker.
// locked in place: no drag region anywhere, the window is pinned top-right.
const NODRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

const WHITE = '#eaf1f7'
// brighter than the app green so it stays legible over the game
const GREEN = '#8fe9b0'

export default function CompactWindowApp(): React.ReactElement {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const route = useStore((s) => s.route)
  const contracts = useStore((s) => s.contracts)
  const order = useStore((s) => s.order)
  const closeCompact = useStore((s) => s.closeCompact)

  useEffect(() => {
    void init()
  }, [init])

  // the route broken into one step per destination, deepest first - same list
  // the grid walks, so step N here is step N there
  const liveSteps = useMemo(
    () => (route ? buildLoadingSteps(contracts, route, order) : []),
    [contracts, route, order]
  )

  const [idx, setIdx] = useState(0)
  // follow the main window's walkthrough while it's driving
  const [driven, setDriven] = useState(false)
  useEffect(
    () =>
      window.supercargo?.onLoadingState?.((s) => {
        setDriven(s.active)
        if (s.active) setIdx(s.idx)
      }),
    []
  )

  // freeze the plan during a load session so a turn-in can't shift the steps,
  // keeping our index aligned with the grid's
  const [frozen, setFrozen] = useState<LoadingStep[] | null>(null)
  useEffect(() => {
    setFrozen((prev) => (driven ? prev ?? liveSteps : null))
  }, [driven, liveSteps])
  const steps = frozen ?? liveSteps

  const pendingObjIds = useMemo(
    () => new Set(contracts.flatMap((c) => c.objectives.filter((o) => !o.delivered).map((o) => o.id))),
    [contracts]
  )

  const safeIdx = Math.min(idx, Math.max(0, steps.length - 1))
  const step = steps[safeIdx]

  // stepping here also advances the grid's loading walkthrough
  const go = (n: number): void => {
    const next = Math.max(0, Math.min(steps.length - 1, n))
    setIdx(next)
    window.supercargo?.setLoadingState?.({ active: true, idx: next })
  }

  // grow/shrink the window to fit whatever's shown
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const send = (): void => {
      void window.supercargo?.compactResize?.(Math.ceil(el.getBoundingClientRect().height))
    }
    const ro = new ResizeObserver(send)
    ro.observe(el)
    send()
    return () => ro.disconnect()
  })

  const isLoad = step?.kind === 'load'
  const dest = step ? splitDestination(step.boundFor) : null
  const destLabel = dest ? (dest.code ? `${dest.code} · ${dest.name}` : dest.name || step!.boundFor) : ''

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'transparent', fontFamily: F.display }}>
      <div ref={contentRef} style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 14 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.22em', color: 'rgba(180,198,210,0.6)' }}>
            {driven ? 'LOADING' : 'SUPERCARGO'}
          </span>
          <Btn
            onClick={closeCompact}
            title="Close overlay"
            style={{
              ...NODRAG,
              border: 0,
              background: 'rgba(0,0,0,0.5)',
              borderRadius: 4,
              color: C.dim,
              cursor: 'pointer',
              display: 'flex',
              padding: 2
            }}
            hoverStyle={{ color: C.text }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </Btn>
        </div>

        {!ready ? null : !step ? (
          <Panel>
            <div style={{ padding: '12px 14px', fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
              No active route. Accept a contract to see your loads here.
            </div>
          </Panel>
        ) : (
          <>
            <Chip title={step.label} counter={`${safeIdx + 1}/${steps.length}`} />

            <Panel>
              <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 0' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                    padding: '7px 14px 5px',
                    fontFamily: F.display,
                    fontSize: 11.5,
                    letterSpacing: '0.16em'
                  }}
                >
                  <span style={{ color: isLoad ? GREEN : C.amber }}>
                    {isLoad ? `LOAD → ${destLabel}` : `DELIVER → ${destLabel}`}
                  </span>
                  {isLoad && step.groupTotal > 1 && step.placement && (
                    <span style={{ fontFamily: F.body, fontSize: 11, letterSpacing: 0, color: 'rgba(185,210,235,0.7)' }}>
                      {step.placement}
                    </span>
                  )}
                </div>
                {step.lines.map((l) => (
                  <LoadLine
                    key={`${step.kind}-${l.objectiveId}`}
                    breakdown={l.breakdown}
                    commodity={l.commodity}
                    tell={isLoad ? l.tell : undefined}
                    delivered={!isLoad && !pendingObjIds.has(l.objectiveId)}
                  />
                ))}
              </div>
            </Panel>

            {steps.length > 1 && (
              <div style={{ display: 'flex', gap: 6 }}>
                <NavBtn label="‹ PREV" onClick={() => go(safeIdx - 1)} disabled={safeIdx === 0} />
                <NavBtn label="NEXT ›" onClick={() => go(safeIdx + 1)} disabled={safeIdx >= steps.length - 1} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Chip({ title, counter }: { title: string; counter: string }): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '10px 15px',
        borderRadius: 9,
        background: 'linear-gradient(180deg, rgba(23,36,49,0.62), rgba(10,16,24,0.62))',
        border: '1px solid rgba(255,210,30,0.7)',
        boxShadow: '0 0 16px rgba(255,210,30,0.28), inset 0 1px 0 rgba(255,255,255,0.12)'
      }}
    >
      <span
        style={{
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: '0.05em',
          color: '#f1f7fc',
          textTransform: 'uppercase',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {title}
      </span>
      <span style={{ fontFamily: F.mono, fontSize: 11, color: 'rgba(185,210,235,0.8)', flex: 'none' }}>
        {counter}
      </span>
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        background: 'rgba(7,13,19,0.6)',
        border: `1px solid rgba(255,210,30,0.32)`,
        borderRadius: 8,
        boxShadow: '0 4px 14px rgba(0,0,0,0.55)',
        overflow: 'hidden'
      }}
    >
      {children}
    </div>
  )
}

// breakdown up front so it matches the Freight Elevator box list, with the
// tell underneath so you know which contract to pull it from. tell undefined
// means a drop (no contract to hunt for).
function LoadLine({
  breakdown,
  commodity,
  tell,
  delivered
}: {
  breakdown: string
  commodity: string
  tell?: string | null
  delivered?: boolean
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '7px 14px', opacity: delivered ? 0.55 : 1 }}>
      <span
        style={{
          width: 11,
          height: 11,
          marginTop: 5,
          flex: 'none',
          transform: 'rotate(45deg)',
          background: delivered
            ? 'linear-gradient(135deg, #8fe9b0, #5fd089)'
            : 'linear-gradient(135deg, #ffe49a 0%, #e6ab3e 52%, #c2862a 100%)',
          border: '1px solid rgba(255,240,190,0.85)',
          boxShadow: '0 0 5px rgba(230,176,60,0.5)'
        }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 15, lineHeight: 1.35, color: WHITE, textDecoration: delivered ? 'line-through' : 'none' }}>
          <span style={{ color: C.amber, fontFamily: F.mono, fontWeight: 600 }}>{breakdown}</span>{' '}
          <span style={{ color: GREEN }}>{commodity}</span>
        </span>
        {delivered && (
          <span style={{ fontFamily: F.body, fontSize: 12, color: GREEN }}>✓ delivered</span>
        )}
        {!delivered && tell !== undefined && (
          <span style={{ fontFamily: F.body, fontSize: 12.5, lineHeight: 1.3, color: 'rgba(196,214,230,0.85)' }}>
            {tell ? (
              <>
                find the contract with <b style={{ color: WHITE }}>{tell}</b>
              </>
            ) : (
              'match by full box set'
            )}
          </span>
        )}
      </span>
    </div>
  )
}

function NavBtn({
  label,
  onClick,
  disabled
}: {
  label: string
  onClick: () => void
  disabled: boolean
}): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      disabled={disabled}
      style={{
        ...NODRAG,
        flex: 1,
        border: `1px solid ${disabled ? 'rgba(255,255,255,0.1)' : 'rgba(255,210,30,0.4)'}`,
        borderRadius: 7,
        background: 'rgba(8,14,20,0.6)',
        color: disabled ? C.ghost : C.dim,
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 11,
        letterSpacing: '0.12em',
        padding: '8px 0'
      }}
      hoverStyle={disabled ? {} : { color: C.text, borderColor: 'rgba(255,210,30,0.75)' }}
    >
      {label}
    </Btn>
  )
}
