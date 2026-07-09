import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { C, F } from '../theme'
import { buildLoadingSteps, filterDeferredSteps, type LoadingStep } from '../state/loading'
import { offGridByObjective, objectiveStops } from '../state/manifest'

const WHITE = '#eaf1f7'
const GREEN = '#8fe9b0'
// window scales to BASE_W * overlayScale (see main/positionCompact)
const BASE_W = 332

export default function CompactWindowApp(): React.ReactElement {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const route = useStore((s) => s.route)
  const contracts = useStore((s) => s.contracts)
  const order = useStore((s) => s.order)
  const looseBoxes = useStore((s) => s.looseBoxes)
  const settings = useStore((s) => s.settings)
  const scale = settings.overlayScale || 1
  const opacity = settings.overlayOpacity ?? 0.85

  useEffect(() => {
    void init()
  }, [init])

  const liveSteps = useMemo(
    () => (route ? buildLoadingSteps(contracts, route, order) : []),
    [contracts, route, order]
  )

  const [idx, setIdx] = useState(0)
  const [driven, setDriven] = useState(false)
  useEffect(
    () =>
      window.supercargo?.onLoadingState?.((s) => {
        setDriven(s.active)
        if (s.active) setIdx(s.idx)
      }),
    []
  )

  // render the main walk (synced via manifest), not our own rebuild, or the index drifts
  const mainSteps = useStore((s) => s.loadingSteps)
  const deferredObjectives = useStore((s) => s.deferredObjectives)
  const grabbedObjectives = useStore((s) => s.grabbedObjectives)
  const tickedObj = useMemo(
    () => new Set(contracts.flatMap((c) => c.objectives.filter((o) => o.pickedUpAt?.length).map((o) => o.id))),
    [contracts]
  )
  const steps = useMemo(() => {
    if (!driven || !mainSteps) return liveSteps
    return filterDeferredSteps(mainSteps, new Set(deferredObjectives), (id) => tickedObj.has(id), new Set(grabbedObjectives))
  }, [driven, mainSteps, liveSteps, deferredObjectives, tickedObj, grabbedObjectives])

  const safeIdx = Math.min(idx, Math.max(0, steps.length - 1))
  const step = steps[safeIdx]

  // never merge by location id
  const visits = useMemo(() => {
    const out: { steps: LoadingStep[] }[] = []
    steps.forEach((s, i) => {
      const prev = i > 0 ? steps[i - 1] : null
      if (out.length && prev && prev.nodeKey === s.nodeKey && prev.trip === s.trip) {
        out[out.length - 1].steps.push(s)
      } else {
        out.push({ steps: [s] })
      }
    })
    return out
  }, [steps])
  let visitIdx = 0
  let seen = 0
  for (let i = 0; i < visits.length; i++) {
    if (safeIdx < seen + visits[i].steps.length) {
      visitIdx = i
      break
    }
    seen += visits[i].steps.length
  }
  const here = visits[visitIdx]?.steps ?? []
  const dropLines = here.filter((s) => s.kind === 'drop').flatMap((s) => s.lines)
  const loadLines = here.filter((s) => s.kind === 'load').flatMap((s) => s.lines)
  const offGrid = useMemo(() => offGridByObjective(contracts, looseBoxes), [contracts, looseBoxes])
  // reuse the grid's per-objective stop colors
  const { color: objColor } = useMemo(() => objectiveStops(route), [route])
  const dropOffGrid = dropLines
    .map((l) => ({ commodity: l.commodity, color: objColor.get(l.objectiveId), tally: offGrid.get(l.objectiveId) }))
    .filter((x): x is { commodity: string; color: string | undefined; tally: NonNullable<typeof x.tally> } => !!x.tally)
  const offGridBoxes = dropOffGrid.reduce((n, x) => n + x.tally.count, 0)
  const handedOver = useMemo(
    () =>
      new Set(
        contracts.flatMap((c) =>
          c.objectives.filter((o) => o.delivered || o.turnedInScu !== undefined).map((o) => o.id)
        )
      ),
    [contracts]
  )
  const stopCounter = step ? `${visitIdx + 1}/${visits.length}` : ''

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

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'transparent', fontFamily: F.display }}>
      <div ref={contentRef} style={{ width: BASE_W, boxSizing: 'border-box', zoom: scale, display: 'flex', flexDirection: 'column', gap: 7, padding: 8 }}>
        {!ready ? null : !step ? (
          <Panel opacity={opacity}>
            <div style={{ padding: '12px 14px', fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
              No active route. Accept a contract to see your loads here.
            </div>
          </Panel>
        ) : (
          <>
            <Chip title={step.label} counter={stopCounter} opacity={opacity} />

            <Panel opacity={opacity}>
              <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 0' }}>
                {dropLines.length > 0 && (
                  <div>
                    <SectionLabel color={C.amber}>DROP OFF HERE</SectionLabel>
                    {dropLines.map((l) => (
                      <LoadLine
                        key={`drop-${l.objectiveId}`}
                        breakdown={l.breakdown}
                        commodity={l.commodity}
                        color={objColor.get(l.objectiveId)}
                        delivered={handedOver.has(l.objectiveId)}
                        tripPos={l.tripPos}
                        tripTotal={l.tripTotal}
                      />
                    ))}
                  </div>
                )}
                {offGridBoxes > 0 && (
                  <div>
                    <SectionLabel color={C.amber}>
                      GRAB OFF-GRID · {offGridBoxes} {offGridBoxes === 1 ? 'BOX' : 'BOXES'}
                    </SectionLabel>
                    {dropOffGrid.map((x, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 14px' }}>
                        <span style={{ width: 6, height: 6, background: x.color ?? C.amber, transform: 'rotate(45deg)', flex: 'none' }} />
                        <span style={{ fontFamily: F.mono, fontSize: 12, color: WHITE }}>{x.tally.breakdown}</span>
                        <span style={{ fontFamily: F.body, fontSize: 12.5, color: GREEN }}>{x.commodity}</span>
                      </div>
                    ))}
                  </div>
                )}
                {loadLines.length > 0 && (
                  <div>
                    <SectionLabel color={GREEN}>PICK UP HERE</SectionLabel>
                    {loadLines.map((l) => (
                      <LoadLine
                        key={`load-${l.objectiveId}`}
                        breakdown={l.breakdown}
                        commodity={l.commodity}
                        color={objColor.get(l.objectiveId)}
                        tell={l.tell}
                        tripPos={l.tripPos}
                        tripTotal={l.tripTotal}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}

function Chip({ title, counter, opacity }: { title: string; counter: string; opacity: number }): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '10px 15px',
        borderRadius: 9,
        background: `linear-gradient(180deg, rgba(23,36,49,${opacity}), rgba(10,16,24,${opacity}))`,
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
        STOP {counter}
      </span>
    </div>
  )
}

function Panel({ children, opacity }: { children: React.ReactNode; opacity: number }): React.ReactElement {
  return (
    <div
      style={{
        background: `rgba(7,13,19,${opacity})`,
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

// tell undefined means a drop
function LoadLine({
  breakdown,
  commodity,
  color,
  tell,
  delivered,
  tripPos,
  tripTotal
}: {
  breakdown: string
  commodity: string
  color?: string
  tell?: string | null
  delivered?: boolean
  tripPos?: number
  tripTotal?: number
}): React.ReactElement {
  const dot = color ?? '#e6ab3e'
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '7px 14px', opacity: delivered ? 0.55 : 1 }}>
      <span
        style={{
          width: 11,
          height: 11,
          marginTop: 5,
          flex: 'none',
          transform: 'rotate(45deg)',
          background: delivered ? 'linear-gradient(135deg, #8fe9b0, #5fd089)' : dot,
          border: '1px solid rgba(255,255,255,0.55)',
          boxShadow: delivered ? 'none' : `0 0 5px ${dot}`
        }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        {!delivered && tell !== undefined && (
          <span style={{ fontFamily: F.body, fontSize: 12.5, lineHeight: 1.3, color: 'rgba(196,214,230,0.85)' }}>
            {tell ? (
              <>
                Find the contract with <b style={{ color: WHITE }}>{tell}</b>
              </>
            ) : (
              'Match by full box set'
            )}
          </span>
        )}
        <span style={{ fontSize: 15, lineHeight: 1.35, color: WHITE, textDecoration: delivered ? 'line-through' : 'none' }}>
          <span style={{ color: dot, fontFamily: F.mono, fontWeight: 600 }}>{breakdown}</span>{' '}
          <span style={{ color: GREEN }}>{commodity}</span>
          {tripTotal && tripTotal > 1 && (
            <span style={{ fontFamily: F.body, fontSize: 11.5, color: C.amber }}> · trip {tripPos}/{tripTotal}</span>
          )}
        </span>
        {delivered && (
          <span style={{ fontFamily: F.body, fontSize: 12, color: GREEN }}>✓ turned in</span>
        )}
      </span>
    </div>
  )
}

function SectionLabel({ color, children }: { color: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ padding: '7px 14px 5px', fontFamily: F.display, fontSize: 11.5, letterSpacing: '0.16em', color }}>
      {children}
    </div>
  )
}
