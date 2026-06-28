import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW, fmt } from '../theme'
import { deriveStopsWithPickups, deriveRouteStops, deriveContracts, deriveTotals, activeContracts, type Stop, type StopItem, type PickupItem } from '../state/manifest'
import { gridCapacity } from '@shared/cargoGrids'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import { Btn } from '../components/ui'
import Typeahead from '../components/Typeahead'
import TurnInModal from '../components/TurnInModal'

const ITEM_GRID = '118px 1fr minmax(160px, 1fr) 70px 104px'

export default function ManifestPage(): React.ReactElement {
  const contracts = useStore((s) => s.contracts)
  const order = useStore((s) => s.order)
  const startLocation = useStore((s) => s.startLocation)
  const groupBy = useStore((s) => s.groupBy)
  const setGroupBy = useStore((s) => s.setGroupBy)
  const showBoxMath = useStore((s) => s.showBoxMath)
  const activeShip = useStore((s) => s.settings.activeShip)
  const installedModules = useStore((s) => s.settings.installedModules)
  const route = useStore((s) => s.route)
  const openCapture = useStore((s) => s.openCapture)
  const turnInDestination = useStore((s) => s.turnInDestination)
  const unmarkTurnIn = useStore((s) => s.unmarkTurnIn)

  const [turnIn, setTurnIn] = useState<{ stop: Stop; item: StopItem } | null>(null)

  const stops = useMemo(
    () =>
      route
        ? deriveRouteStops(contracts, route, order)
        : deriveStopsWithPickups(contracts, order, startLocation),
    [route, contracts, order, startLocation]
  )
  const totals = useMemo(
    () => deriveTotals(stops.filter((s) => !s.pickupOnly), contracts),
    [stops, contracts]
  )
  const derivedContracts = useMemo(() => deriveContracts(activeContracts(contracts)), [contracts])

  // usable bays only, no elevators or secure storage
  const capMax = gridCapacity(activeShip, installedModules[activeShip])
  const currentLoad = route?.startLoad ?? 0
  const here = route?.startStop || startLocation || activeShip
  const trips = route?.trips ?? 0
  const capPct = capMax > 0 ? Math.min(100, Math.round((currentLoad / capMax) * 100)) : 0
  const room = Math.max(0, capMax - currentLoad)
  const capColor = capPct <= 50 ? C.green : capPct <= 80 ? C.amber : C.red

  if (totals.contracts === 0) {
    return (
      <div style={{ padding: PAGE_PADDING }}>
        <PageHeader title="CARGO MANIFEST" subtitle="No active contracts" />
        <EmptyState onAdd={() => openCapture()} />
      </div>
    )
  }

  return (
    <div style={{ padding: PAGE_PADDING }}>
      <PageHeader
        title="CARGO MANIFEST"
        subtitle={`${totals.contracts} active contracts · ${totals.dests} delivery stops`}
        right={<GroupToggle groupBy={groupBy} setGroupBy={setGroupBy} />}
      />

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'stretch',
          borderTop: `1px solid ${C.lineStrong}`,
          borderBottom: `1px solid ${C.lineStrong}`,
          marginBottom: 26
        }}
      >
        <SummaryStat label="TOTAL SCU" value={fmt(totals.scu)} first />
        <SummaryStat label="BOXES" value={fmt(totals.boxes)} />
        <SummaryStat label="DESTINATIONS" value={String(totals.dests)} />
        <div style={{ flex: 1, minWidth: 240, padding: '16px 0 16px 34px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 9 }}>
            <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.dim }}>
              LOADED · {here}
              {trips > 1 && <span style={{ color: C.amber }}>{'  '}· TRIP 1 / {trips}</span>}
            </span>
            <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body }}>
              {fmt(currentLoad)} / {fmt(capMax)} SCU
              <span style={{ color: C.dim }}> · room for {fmt(room)}</span>
            </span>
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.10)', width: '100%' }}>
            <div style={{ height: '100%', width: `${Math.min(100, capPct)}%`, background: capColor }} />
          </div>
        </div>
      </div>

      <StartLocationPicker />

      <MissingObjectivesBanner
        contracts={derivedContracts.filter((c) => c.objCount === 0)}
        onAdd={openCapture}
      />

      {groupBy === 'destination' ? (
        <ByDestination stops={stops} showBoxMath={showBoxMath} holdScu={capMax} onTurnIn={(stop, item) => setTurnIn({ stop, item })} />
      ) : (
        <ByContract contracts={derivedContracts} showBoxMath={showBoxMath} />
      )}

      {turnIn && (
        <TurnInModal
          heading={turnIn.stop.code ? `${turnIn.stop.code} · ${turnIn.stop.name}` : turnIn.stop.name}
          sub="Mark what you handed over. You can change it until the game finishes the contract."
          items={[
            {
              objectiveId: turnIn.item.objectiveId,
              contractId: turnIn.item.contractId,
              breakdown: turnIn.item.boxStr,
              commodity: turnIn.item.commodity,
              ref: turnIn.item.ref,
              totalScu: turnIn.item.scu,
              turnedInScu: turnIn.item.turnedInScu
            }
          ]}
          onSave={(entries) => {
            turnInDestination(entries)
            setTurnIn(null)
          }}
          onUnmark={(ids) => {
            unmarkTurnIn(ids)
            setTurnIn(null)
          }}
          onClose={() => setTurnIn(null)}
        />
      )}
    </div>
  )
}

function MissingObjectivesBanner({
  contracts,
  onAdd
}: {
  contracts: ReturnType<typeof deriveContracts>
  onAdd: (id: string) => void
}): React.ReactElement | null {
  if (contracts.length === 0) return null
  const first = contracts[0]
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '13px 16px',
        marginBottom: 22,
        border: `1px solid ${C.amber}`,
        background: 'rgba(216,166,74,0.06)'
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.amber, flex: 'none' }} />
      <div style={{ flex: 1, fontFamily: F.body, fontSize: 13, color: C.textBody, lineHeight: 1.5 }}>
        {contracts.length === 1 ? '1 contract needs' : `${contracts.length} contracts need`} details.
        Add them manually on the Contracts tab so they appear on the Manifest.
      </div>
      <Btn
        onClick={() => onAdd(first.id)}
        style={{
          border: `1px solid ${C.amber}`,
          background: 'transparent',
          color: C.amber,
          fontFamily: F.display,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.14em',
          padding: '7px 13px',
          cursor: 'pointer',
          flex: 'none'
        }}
        hoverStyle={{ background: 'rgba(216,166,74,0.12)' }}
      >
        ADD OBJECTIVES · {first.ref}
      </Btn>
    </div>
  )
}

function StartLocationPicker(): React.ReactElement {
  const startLocation = useStore((s) => s.startLocation)
  const setStartLocation = useStore((s) => s.setStartLocation)
  const locations = useStore((s) => s.locations)
  const route = useStore((s) => s.route)
  const names = useMemo(() => locations.map((l) => l.name), [locations])
  const loadHere = route?.steps.find((s) => s.nodeKey === 'depot')?.loadAfter ?? 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
      <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.dim, flex: 'none' }}>
        STARTING AT
      </span>
      <div style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 380 }}>
        <Typeahead
          value={startLocation}
          options={names}
          freeText={false}
          search
          maxResults={12}
          onSelect={setStartLocation}
          placeholder="Where you're starting (optional)"
        />
      </div>
      {startLocation && (
        <>
          {loadHere > 0 && (
            <span style={{ fontFamily: F.body, fontSize: 12.5, color: C.acc, flex: 'none' }}>
              ↥ load {fmt(loadHere)} SCU here
            </span>
          )}
          <Btn
            onClick={() => setStartLocation('')}
            title="Clear the starting location"
            style={{
              border: `1px solid ${C.lineStrong}`,
              background: 'transparent',
              color: C.dim,
              fontFamily: F.display,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.14em',
              padding: '6px 10px',
              cursor: 'pointer',
              flex: 'none'
            }}
            hoverStyle={{ border: `1px solid ${C.acc}`, color: C.text }}
          >
            CLEAR
          </Btn>
        </>
      )}
    </div>
  )
}

function SummaryStat({ label, value, first }: { label: string; value: string; first?: boolean }): React.ReactElement {
  return (
    <div
      style={{
        flex: '0 0 auto',
        padding: first ? '16px 34px 16px 0' : '16px 34px',
        borderRight: `1px solid ${C.lineFaint}`
      }}
    >
      <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.dim }}>{label}</div>
      <div style={{ fontFamily: F.mono, fontSize: 30, fontWeight: 600, color: C.text, textShadow: GLOW, lineHeight: 1.15 }}>
        {value}
      </div>
    </div>
  )
}

function GroupToggle({
  groupBy,
  setGroupBy
}: {
  groupBy: 'destination' | 'contract'
  setGroupBy: (g: 'destination' | 'contract') => void
}): React.ReactElement {
  const tab = (id: 'destination' | 'contract', label: string): React.ReactElement => {
    const active = groupBy === id
    return (
      <Btn
        onClick={() => setGroupBy(id)}
        style={{
          border: 0,
          background: active ? C.accFill : 'transparent',
          color: active ? C.text : C.dim,
          textShadow: active ? GLOW : 'none',
          fontFamily: F.display,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.14em',
          padding: '7px 14px',
          cursor: 'pointer',
          borderBottom: `2px solid ${active ? C.acc : 'transparent'}`
        }}
        hoverStyle={active ? {} : { color: C.body }}
      >
        {label}
      </Btn>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.dim }}>GROUP BY</span>
      <div style={{ display: 'flex', border: `1px solid ${C.lineStrong}` }}>
        {tab('destination', 'DESTINATION')}
        {tab('contract', 'CONTRACT')}
      </div>
    </div>
  )
}

function ByDestination({
  stops,
  showBoxMath,
  holdScu,
  onTurnIn
}: {
  stops: Stop[]
  showBoxMath: boolean
  holdScu: number
  onTurnIn: (stop: Stop, item: StopItem) => void
}): React.ReactElement {
  const reorderStops = useStore((s) => s.reorderStops)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: C.faint }}>
        <DotsIcon />
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.18em' }}>
          DRAG STOPS TO REORDER DELIVERY
        </span>
      </div>

      {stops.map((stop) => (
        <div
          key={`${stop.idx}-${stop.pickupOnly ? 'p' : 'd'}-${stop.destination}`}
          draggable={!stop.start}
          onDragStart={(e) => {
            if (stop.start) return
            setDragIdx(stop.idx)
            try {
              e.dataTransfer.effectAllowed = 'move'
            } catch {
              /* ignore */
            }
          }}
          onDragOver={(e) => {
            if (stop.start) return
            e.preventDefault()
            if (overIdx !== stop.idx) setOverIdx(stop.idx)
          }}
          onDragLeave={() => setOverIdx((v) => (v === stop.idx ? null : v))}
          onDrop={(e) => {
            if (stop.start) return
            e.preventDefault()
            const fromKey = dragIdx !== null ? stops[dragIdx]?.nodeKey : undefined
            if (fromKey && stop.nodeKey && fromKey !== stop.nodeKey) reorderStops(fromKey, stop.nodeKey)
            setDragIdx(null)
            setOverIdx(null)
          }}
          onDragEnd={() => {
            setDragIdx(null)
            setOverIdx(null)
          }}
          style={{
            marginBottom: 16,
            opacity: dragIdx === stop.idx ? 0.45 : 1,
            outline: overIdx === stop.idx && dragIdx !== stop.idx ? `1px solid ${C.accBorder}` : 'none',
            outlineOffset: 6
          }}
        >
          <StopHeader stop={stop} />
          {!stop.pickupOnly && stop.items.map((item) => {
            // color tracks turn-in fullness
            const tiColor =
              item.turnedInScu === undefined
                ? C.textBody
                : item.turnedInScu >= item.scu
                  ? C.green
                  : item.turnedInScu <= 0
                    ? C.red
                    : C.amber
            return (
            <div
              key={item.objectiveId}
              style={{
                display: 'grid',
                gridTemplateColumns: ITEM_GRID,
                alignItems: 'center',
                gap: 18,
                padding: '7px 0 7px 39px',
                borderBottom: `1px solid ${C.lineSoft}`,
                opacity: item.delivered || item.turnedInScu !== undefined ? 0.45 : 1
              }}
            >
              <div
                style={{
                  fontFamily: F.mono,
                  fontSize: 17,
                  color: C.text,
                  textShadow: GLOW,
                  textAlign: 'right',
                  textDecoration: item.delivered || item.turnedInScu !== undefined ? 'line-through' : 'none'
                }}
              >
                {item.scu}
                <span style={{ fontSize: 11, color: C.dim }}> SCU</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, minWidth: 0 }}>
                <span
                  style={{
                    fontFamily: F.body,
                    fontSize: 15,
                    color: C.textBody,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {item.commodity}
                </span>
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint, flex: 'none' }}>[{item.ref}]</span>
              </div>
              {showBoxMath ? (
                <div style={{ fontFamily: F.mono, fontSize: 13, color: '#b6bec0' }}>
                  <span style={{ color: C.faint }}>· </span>
                  {item.boxStr || '-'}
                </div>
              ) : (
                <div />
              )}
              <div style={{ fontFamily: F.mono, fontSize: 12, color: C.dim, textAlign: 'right' }}>
                {item.boxCount} box
              </div>
              {item.delivered ? (
                <span />
              ) : (
                <Btn
                  onClick={() => onTurnIn(stop, item)}
                  title={item.turnedInScu !== undefined ? 'Edit what you delivered' : 'Record what you handed over'}
                  style={{ border: `1px solid ${tiColor}`, background: 'transparent', color: tiColor, fontFamily: F.display, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', padding: '6px 0', cursor: 'pointer', textAlign: 'center' }}
                  hoverStyle={{ background: 'rgba(255,255,255,0.06)', textShadow: GLOW }}
                >
                  {item.turnedInScu !== undefined ? '✎ DELIVERED' : 'TURN IN'}
                </Btn>
              )}
            </div>
            )
          })}
          {stop.pickups && stop.pickups.length > 0 && (
            <PickupSection items={stop.pickups} showBoxMath={showBoxMath} label={!stop.pickupOnly} />
          )}
        </div>
      ))}
    </div>
  )
}

function PickupSection({ items, showBoxMath, label }: { items: PickupItem[]; showBoxMath: boolean; label: boolean }): React.ReactElement {
  const setPickedUp = useStore((s) => s.setPickedUp)
  return (
    <div style={{ marginTop: 6 }}>
      {label && (
        <div style={{ padding: '8px 0 2px 39px', fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.green }}>
          ↑ PICK UP HERE
        </div>
      )}
      {items.map((it) => (
          <div
            key={`${it.objectiveId}-${it.pickupKey}`}
            style={{
              display: 'grid',
              gridTemplateColumns: ITEM_GRID,
              alignItems: 'center',
              gap: 18,
              padding: '6px 0 6px 39px',
              borderBottom: `1px solid ${C.lineSoft}`,
              opacity: it.picked ? 0.5 : 1
            }}
          >
            <div style={{ fontFamily: F.mono, fontSize: 17, color: C.green, textAlign: 'right', textDecoration: it.picked ? 'line-through' : 'none' }}>
              {it.scu}
              <span style={{ fontSize: 11, color: C.dim }}> SCU</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, minWidth: 0 }}>
              <span style={{ fontFamily: F.body, fontSize: 15, color: C.textBody, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {it.commodity}
              </span>
              <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint, flex: 'none' }}>[{it.ref}]</span>
            </div>
            {showBoxMath ? (
              <div style={{ fontFamily: F.mono, fontSize: 13, color: '#b6bec0' }}>
                <span style={{ color: C.faint }}>· </span>
                {it.boxStr || '-'}
              </div>
            ) : (
              <div />
            )}
            <div style={{ fontFamily: F.mono, fontSize: 12, color: C.dim, textAlign: 'right' }}>{it.boxCount} box</div>
            {it.pickupKey ? (
              <Btn
                onClick={() => setPickedUp(it.contractId, it.objectiveId, it.pickupKey as string, !it.picked)}
                title={it.picked ? 'Mark as not yet collected' : 'Check off this pickup'}
                style={{ border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: F.display, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', padding: '6px 0', cursor: 'pointer', textAlign: 'center' }}
                hoverStyle={{ background: 'rgba(95,208,137,0.10)', textShadow: GLOW }}
              >
                {it.picked ? '✓ PICKED UP' : 'PICK UP'}
              </Btn>
            ) : (
              <div />
            )}
          </div>
        )
      )}
    </div>
  )
}

function StopHeader({ stop }: { stop: Stop }): React.ReactElement {
  const locations = useStore((s) => s.locations)
  const loc = useMemo(() => locations.find((l) => l.name === stop.destination), [locations, stop.destination])
  const external = stop.hasElevator ?? loc?.hasElevator
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 12, borderBottom: `1px solid ${C.lineStrong}` }}>
      {stop.start ? (
        <div style={{ color: C.acc, display: 'flex', flex: 'none', fontSize: 19, lineHeight: 1 }} title="Starting location">
          ▸
        </div>
      ) : (
        <div style={{ cursor: 'grab', color: '#a3adb1', display: 'flex', flex: 'none' }} title="Drag to reorder">
          <GripIcon />
        </div>
      )}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: F.display,
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: '0.03em',
          color: C.text,
          textShadow: GLOW,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {stop.destination || stop.name}
      </span>
      <ElevatorBadge external={external} />
    </div>
  )
}

function PickupNote({ pickups }: { pickups?: string[] }): React.ReactElement | null {
  const uniq = pickups ? [...new Set(pickups)] : []
  if (!uniq.length) return null
  return (
    <span
      title={`Pick up from ${uniq.join(', ')}`}
      style={{ fontFamily: F.body, fontSize: 11.5, color: C.acc, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      ↤ from {uniq.join(' · ')}
    </span>
  )
}

function ElevatorBadge({ external }: { external?: boolean }): React.ReactElement | null {
  if (external === undefined) return null
  const color = external ? C.green : C.amber
  const text = external ? 'EXTERNAL ELEVATOR' : 'INTERNAL ELEVATOR'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 'none' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color }}>{text}</span>
    </div>
  )
}

function ByContract({
  contracts,
  showBoxMath
}: {
  contracts: ReturnType<typeof deriveContracts>
  showBoxMath: boolean
}): React.ReactElement {
  return (
    <div>
      {contracts.map((c) => (
        <div key={c.id} style={{ marginBottom: 26 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 12, borderBottom: `1px solid ${C.lineStrong}` }}>
            <div style={{ fontFamily: F.mono, fontSize: 15, color: C.acc, flex: 'none' }}>{c.ref}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: F.display, fontSize: 18, fontWeight: 600, letterSpacing: '0.03em', color: C.text, textShadow: GLOW }}>
                {c.title}
              </div>
              <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 2 }}>
                {c.pickup ? `Pickup · ${c.pickup} · ` : ''}max box {c.maxBox} SCU
              </div>
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 15, color: C.text, textShadow: GLOW, flex: 'none' }}>
              {c.totSCU}
              <span style={{ fontSize: 11, color: C.dim }}> SCU</span>
            </div>
          </div>
          {c.objectives.map((o) => (
            <div
              key={o.objectiveId}
              style={{ display: 'grid', gridTemplateColumns: ITEM_GRID, alignItems: 'center', gap: 18, padding: '13px 0 13px 31px', borderBottom: `1px solid ${C.lineSoft}` }}
            >
              <div style={{ fontFamily: F.mono, fontSize: 17, color: C.text, textShadow: GLOW, textAlign: 'right' }}>
                {o.scu}
                <span style={{ fontSize: 11, color: C.dim }}> SCU</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontFamily: F.body, fontSize: 15, color: C.textBody }}>{o.commodity}</span>
                <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>{o.destination}</span>
                <PickupNote pickups={o.pickups} />
              </div>
              {showBoxMath ? (
                <div style={{ fontFamily: F.mono, fontSize: 13, color: '#b6bec0' }}>
                  <span style={{ color: C.faint }}>· </span>
                  {o.boxStr || '-'}
                </div>
              ) : (
                <div />
              )}
              <div style={{ fontFamily: F.mono, fontSize: 12, color: C.dim, textAlign: 'right' }}>{o.boxCount} box</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        padding: '90px 0',
        textAlign: 'center'
      }}
    >
      <div style={{ fontFamily: F.body, fontSize: 14, color: C.dim, maxWidth: 460, lineHeight: 1.6 }}>
        Accept a hauling contract in-game, or add one manually. SuperCargo consolidates every
        objective into a single manifest grouped by destination, with box breakdowns.
      </div>
      <Btn
        onClick={onAdd}
        style={{
          border: `1px solid ${C.acc}`,
          background: C.accFill,
          color: C.text,
          textShadow: GLOW,
          fontFamily: F.display,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.16em',
          padding: '11px 22px',
          cursor: 'pointer'
        }}
        hoverStyle={{ background: C.accFillStrong }}
      >
        + ADD CONTRACT
      </Btn>
    </div>
  )
}

function DotsIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="9" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="6" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="18" r="1" />
    </svg>
  )
}

function GripIcon(): React.ReactElement {
  return (
    <svg width="15" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="5" r="1.3" /><circle cx="9" cy="12" r="1.3" /><circle cx="9" cy="19" r="1.3" />
      <circle cx="15" cy="5" r="1.3" /><circle cx="15" cy="12" r="1.3" /><circle cx="15" cy="19" r="1.3" />
    </svg>
  )
}
