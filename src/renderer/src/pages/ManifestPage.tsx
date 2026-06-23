import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW, fmt } from '../theme'
import { deriveStopsWithPickups, deriveContracts, deriveTotals, activeContracts, type Stop, type PickupItem } from '../state/manifest'
import { shipCapacity } from '@shared/shipModules'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import { Btn } from '../components/ui'
import Typeahead from '../components/Typeahead'
import { splitDestination } from '../data/stations'

const ITEM_GRID = '118px 1fr minmax(160px, 1fr) 70px'

export default function ManifestPage(): React.ReactElement {
  const contracts = useStore((s) => s.contracts)
  const order = useStore((s) => s.order)
  const startLocation = useStore((s) => s.startLocation)
  const groupBy = useStore((s) => s.groupBy)
  const setGroupBy = useStore((s) => s.setGroupBy)
  const showBoxMath = useStore((s) => s.showBoxMath)
  const activeShip = useStore((s) => s.settings.activeShip)
  const installedModules = useStore((s) => s.settings.installedModules)
  const ships = useStore((s) => s.ships)
  const openCapture = useStore((s) => s.openCapture)
  const turnInDestination = useStore((s) => s.turnInDestination)

  const [turnInStop, setTurnInStop] = useState<Stop | null>(null)

  const stops = useMemo(
    () => deriveStopsWithPickups(contracts, order, startLocation),
    [contracts, order, startLocation]
  )
  const totals = useMemo(
    () => deriveTotals(stops.filter((s) => !s.pickupOnly), contracts),
    [stops, contracts]
  )
  // activeContracts already drops finished and held-pending-OCR contracts, so a
  // contract being captured stays out of the list until its capture resolves.
  const derivedContracts = useMemo(() => deriveContracts(activeContracts(contracts)), [contracts])

  const capMax = shipCapacity(ships.find((s) => s.name === activeShip), installedModules[activeShip])
  const capPct = capMax > 0 ? Math.min(999, Math.round((totals.scu / capMax) * 100)) : 0
  const over = capMax > 0 && totals.scu > capMax
  // Hold-capacity color: <=50% green, 51-75% yellow, >75% (including over) red.
  const capColor = capPct <= 50 ? C.green : capPct <= 75 ? C.amber : C.red

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
              HOLD CAPACITY · {activeShip}
            </span>
            <span style={{ fontFamily: F.mono, fontSize: 13, color: over ? C.red : C.body }}>
              {fmt(totals.scu)} / {fmt(capMax)} SCU
              <span style={{ color: C.dim }}> · {capPct}%</span>
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
        <ByDestination stops={stops} showBoxMath={showBoxMath} onTurnIn={setTurnInStop} />
      ) : (
        <ByContract contracts={derivedContracts} showBoxMath={showBoxMath} />
      )}

      {turnInStop && (
        <TurnInModal
          stop={turnInStop}
          onClose={() => setTurnInStop(null)}
          onSubmit={(entries) => {
            turnInDestination(entries)
            setTurnInStop(null)
          }}
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
        {contracts.length === 1 ? '1 contract has' : `${contracts.length} contracts have`} no objective
        details yet. Star Citizen only logs them for the first contract accepted per session. Add them
        manually so they appear on the manifest.
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

/** Sets the run's starting location. Cargo picked up there loads first and the
 *  route is solved from it, so a stop you deliver to but haven't loaded for yet
 *  no longer lands at the front. Optional - blank lets the solver pick the start. */
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
            hoverStyle={{ borderColor: C.acc, color: C.text }}
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
  onTurnIn
}: {
  stops: Stop[]
  showBoxMath: boolean
  onTurnIn: (stop: Stop) => void
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
          key={stop.pickupOnly ? `pk-${stop.destination}` : stop.destination}
          draggable={!stop.pickupOnly}
          onDragStart={(e) => {
            if (stop.pickupOnly) return
            setDragIdx(stop.idx)
            try {
              e.dataTransfer.effectAllowed = 'move'
            } catch {
              /* ignore */
            }
          }}
          onDragOver={(e) => {
            if (stop.pickupOnly) return
            e.preventDefault()
            if (overIdx !== stop.idx) setOverIdx(stop.idx)
          }}
          onDragLeave={() => setOverIdx((v) => (v === stop.idx ? null : v))}
          onDrop={(e) => {
            if (stop.pickupOnly) return
            e.preventDefault()
            if (dragIdx !== null && dragIdx !== stop.idx) reorderStops(dragIdx, stop.idx)
            setDragIdx(null)
            setOverIdx(null)
          }}
          onDragEnd={() => {
            setDragIdx(null)
            setOverIdx(null)
          }}
          style={{
            marginBottom: 26,
            opacity: dragIdx === stop.idx ? 0.45 : 1,
            outline: overIdx === stop.idx && dragIdx !== stop.idx ? `1px solid ${C.accBorder}` : 'none',
            outlineOffset: 6
          }}
        >
          <StopHeader stop={stop} onTurnIn={() => onTurnIn(stop)} />
          {!stop.pickupOnly && stop.items.map((item) => (
            <div
              key={item.objectiveId}
              style={{
                display: 'grid',
                gridTemplateColumns: ITEM_GRID,
                alignItems: 'center',
                gap: 18,
                padding: '13px 0 13px 39px',
                borderBottom: `1px solid ${C.lineSoft}`,
                opacity: item.delivered ? 0.45 : 1
              }}
            >
              <div
                style={{
                  fontFamily: F.mono,
                  fontSize: 17,
                  color: C.text,
                  textShadow: GLOW,
                  textAlign: 'right',
                  textDecoration: item.delivered ? 'line-through' : 'none'
                }}
              >
                {item.scu}
                <span style={{ fontSize: 11, color: C.dim }}> SCU</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
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
                <PickupNote pickups={item.pickups} />
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
            </div>
          ))}
          {!stop.pickupOnly && (
            <div style={{ display: 'grid', gridTemplateColumns: ITEM_GRID, alignItems: 'center', gap: 18, padding: '11px 0 0 39px' }}>
              <div style={{ fontFamily: F.mono, fontSize: 15, color: C.acc, textAlign: 'right' }}>
                {stop.totSCU}
                <span style={{ fontSize: 11, color: C.accDeep }}> SCU</span>
              </div>
              <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.faint }}>STOP TOTAL</div>
              <div style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>{stop.totContracts} contracts</div>
              <div style={{ fontFamily: F.mono, fontSize: 12, color: C.body, textAlign: 'right' }}>{stop.totBoxes} box</div>
            </div>
          )}
          {stop.pickups && stop.pickups.length > 0 && (
            <PickupSection items={stop.pickups} showBoxMath={showBoxMath} />
          )}
        </div>
      ))}
    </div>
  )
}

/** "PICK UP HERE" block under a stop's drop-offs: cargo loaded at this location and
 *  where each piece is headed. Green to set it apart from the drop-off rows. */
function PickupSection({ items, showBoxMath }: { items: PickupItem[]; showBoxMath: boolean }): React.ReactElement {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ padding: '12px 0 2px 39px', fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.green }}>
        ↑ PICK UP HERE
      </div>
      {items.map((it) => {
        const dest = splitDestination(it.destination)
        return (
          <div
            key={`${it.objectiveId}-${it.destination}`}
            style={{
              display: 'grid',
              gridTemplateColumns: ITEM_GRID,
              alignItems: 'center',
              gap: 18,
              padding: '11px 0 11px 39px',
              borderBottom: `1px solid ${C.lineSoft}`
            }}
          >
            <div style={{ fontFamily: F.mono, fontSize: 17, color: C.green, textAlign: 'right' }}>
              {it.scu}
              <span style={{ fontSize: 11, color: C.dim }}> SCU</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, minWidth: 0 }}>
                <span style={{ fontFamily: F.body, fontSize: 15, color: C.textBody, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {it.commodity}
                </span>
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint, flex: 'none' }}>[{it.ref}]</span>
              </div>
              <span style={{ fontFamily: F.body, fontSize: 11.5, color: C.green, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                → {dest.code || dest.name || it.destination}
                {it.split ? ' · split pickup' : ''}
              </span>
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
          </div>
        )
      })}
    </div>
  )
}

function StopHeader({ stop, onTurnIn }: { stop: Stop; onTurnIn: () => void }): React.ReactElement {
  const locations = useStore((s) => s.locations)
  // External-elevator flag: a manual override wins (stop.hasElevator), otherwise use
  // the UEX loading-dock flag on the matched location.
  const loc = useMemo(() => locations.find((l) => l.name === stop.destination), [locations, stop.destination])
  const external = stop.hasElevator ?? loc?.hasElevator
  const anyLeft = stop.items.some((i) => !i.delivered)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 12, borderBottom: `1px solid ${C.lineStrong}` }}>
      {stop.pickupOnly ? (
        <div
          style={{ color: stop.start ? C.acc : C.green, display: 'flex', flex: 'none', fontSize: 19, lineHeight: 1 }}
          title={stop.start ? 'Starting location' : 'Pick-up stop'}
        >
          {stop.start ? '▸' : '↑'}
        </div>
      ) : (
        <div style={{ cursor: 'grab', color: '#a3adb1', display: 'flex', flex: 'none' }} title="Drag to reorder">
          <GripIcon />
        </div>
      )}
      <div style={{ width: 11, height: 11, flex: 'none', background: stop.color }} />
      {!stop.pickupOnly && (
        <div style={{ fontFamily: F.mono, fontSize: 24, fontWeight: 600, color: C.text, textShadow: GLOW, flex: 'none', lineHeight: 1 }}>
          {stop.n}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          {stop.code && <span style={{ fontFamily: F.mono, fontSize: 13, color: C.acc, letterSpacing: '0.02em' }}>{stop.code}</span>}
          <span
            style={{
              fontFamily: F.display,
              fontSize: 19,
              fontWeight: 600,
              letterSpacing: '0.03em',
              color: C.text,
              textShadow: GLOW,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {stop.name}
          </span>
        </div>
        {stop.region && <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 2 }}>{stop.region}</div>}
      </div>
      {stop.pickupOnly && (
        <span
          style={{
            fontFamily: F.display,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.14em',
            color: stop.start ? C.acc : C.green,
            border: `1px solid ${stop.start ? C.acc : C.green}`,
            padding: '4px 10px',
            flex: 'none'
          }}
        >
          {stop.start ? 'START' : 'PICK UP'}
        </span>
      )}
      <ElevatorBadge external={external} />
      {anyLeft && (
        <Btn
          onClick={onTurnIn}
          title="Record what you turned in here"
          style={{
            border: `1px solid ${C.green}`,
            background: 'rgba(95,208,137,0.10)',
            color: C.text,
            fontFamily: F.display,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.14em',
            padding: '7px 13px',
            cursor: 'pointer',
            flex: 'none'
          }}
          hoverStyle={{ background: 'rgba(95,208,137,0.2)', textShadow: GLOW }}
        >
          TURN IN HERE
        </Btn>
      )}
    </div>
  )
}

/** "from A · B" note for an objective that loads somewhere other than the
 *  contract's default pickup (multi-pickup / chain hauls). */
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

type TurnInMode = 'full' | 'part' | 'none'

/** Per-destination turn-in: record FULL / PARTIAL / NONE for each objective at this
 *  stop. Any turn-in clears the stop from the cargo grid (a partial only happens when
 *  you never had the missing boxes, so nothing's left aboard); the SCU just feeds the
 *  payout. Submitting marks them delivered and locks the layout if it wasn't. */
function TurnInModal({
  stop,
  onClose,
  onSubmit
}: {
  stop: Stop
  onClose: () => void
  onSubmit: (entries: Array<{ contractId: string; objectiveId: string; deliveredScu: number }>) => void
}): React.ReactElement {
  const items = useMemo(() => stop.items.filter((i) => !i.delivered), [stop])
  const [rows, setRows] = useState<Record<string, { mode: TurnInMode; amount: number }>>(() =>
    Object.fromEntries(items.map((i) => [i.objectiveId, { mode: 'full' as TurnInMode, amount: i.scu }]))
  )
  const set = (id: string, patch: Partial<{ mode: TurnInMode; amount: number }>): void =>
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }))

  const submit = (): void => {
    onSubmit(
      items.map((i) => {
        const st = rows[i.objectiveId] ?? { mode: 'full' as TurnInMode, amount: i.scu }
        const deliveredScu =
          st.mode === 'full'
            ? i.scu
            : st.mode === 'none'
              ? 0
              : Math.max(0, Math.min(i.scu, Math.round(st.amount || 0)))
        return { contractId: i.contractId, objectiveId: i.objectiveId, deliveredScu }
      })
    )
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 50 }}>
      <div style={{ width: 620, maxWidth: '100%', maxHeight: '100%', overflowY: 'auto', background: C.black, border: `1px solid rgba(255,255,255,0.22)`, fontFamily: F.body }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.lineStrong}` }}>
          <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600, letterSpacing: '0.08em', color: C.text, textShadow: GLOW }}>
            TURN IN · {stop.code || stop.name}
          </div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 2 }}>
            Mark what you handed over here. This clears the stop from your cargo grid.
          </div>
        </div>

        <div style={{ padding: '8px 20px 16px' }}>
          {items.map((i) => {
            const st = rows[i.objectiveId] ?? { mode: 'full' as TurnInMode, amount: i.scu }
            return (
              <div key={i.objectiveId} style={{ display: 'grid', gridTemplateColumns: '1fr 186px 96px', gap: 14, alignItems: 'center', padding: '11px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontFamily: F.body, fontSize: 14, color: C.textBody }}>{i.commodity}</span>{' '}
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>[{i.ref}]</span>
                  <div style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>{i.scu} SCU required</div>
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Seg label="FULL" color={C.green} active={st.mode === 'full'} onClick={() => set(i.objectiveId, { mode: 'full', amount: i.scu })} />
                  <Seg
                    label="PARTIAL"
                    color={C.amber}
                    active={st.mode === 'part'}
                    onClick={() =>
                      set(i.objectiveId, {
                        mode: 'part',
                        amount: st.amount > 0 && st.amount < i.scu ? st.amount : Math.max(1, Math.min(i.scu - 1, Math.round(i.scu / 2)))
                      })
                    }
                  />
                  <Seg label="NONE" color={C.red} active={st.mode === 'none'} onClick={() => set(i.objectiveId, { mode: 'none', amount: 0 })} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  {st.mode === 'part' ? (
                    <input
                      value={st.amount || ''}
                      onChange={(e) =>
                        set(i.objectiveId, {
                          amount: Math.max(0, Math.min(i.scu, parseInt(e.target.value.replace(/[^0-9]/g, '') || '0', 10) || 0))
                        })
                      }
                      inputMode="numeric"
                      style={{ width: 70, background: 'transparent', border: 0, borderBottom: `1px solid rgba(255,255,255,0.25)`, color: C.text, fontFamily: F.mono, fontSize: 14, textAlign: 'right', padding: '4px 0', outline: 'none' }}
                    />
                  ) : (
                    <span style={{ fontFamily: F.mono, fontSize: 13, color: C.dim }}>{st.mode === 'full' ? i.scu : 0} SCU</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', borderTop: `1px solid ${C.lineStrong}` }}>
          <Btn onClick={onClose} style={{ border: `1px solid rgba(255,255,255,0.18)`, background: 'transparent', color: C.body, fontFamily: F.display, fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', padding: '9px 18px', cursor: 'pointer' }} hoverStyle={{ border: `1px solid #fff`, color: C.text }}>
            CANCEL
          </Btn>
          <Btn onClick={submit} style={{ border: `1px solid ${C.green}`, background: 'rgba(95,208,137,0.14)', color: C.text, fontFamily: F.display, fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', padding: '9px 18px', cursor: 'pointer' }} hoverStyle={{ background: 'rgba(95,208,137,0.24)', textShadow: GLOW }}>
            TURN IN
          </Btn>
        </div>
      </div>
    </div>
  )
}

function Seg({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{ border: `1px solid ${active ? color : 'rgba(255,255,255,0.16)'}`, background: active ? 'rgba(255,255,255,0.04)' : 'transparent', color: active ? color : C.dim, fontFamily: F.display, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', padding: '5px 9px', cursor: 'pointer' }}
      hoverStyle={{ border: `1px solid ${color}`, color }}
    >
      {label}
    </Btn>
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
