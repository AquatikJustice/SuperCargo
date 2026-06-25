import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useStore } from '../state/store'
import { C, F, GLOW, fmt } from '../theme'
import { packBoxes, deriveStops } from '../state/manifest'
import { layoutStops } from '../state/layout'
import { buildLoadingSteps, type LoadingStep } from '../state/loading'
import { firstTripFilter } from '../state/route'
import { splitDestination } from '../data/stations'
import { gridsFor, type CargoGrid } from '@shared/cargoGrids'
import { packCargo, type Placement, type PackBox } from '@shared/packer'
import { Btn } from '../components/ui'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import Placeholder from '../components/Placeholder'

// keeps stacked boxes visible
const GAP = 0.08

// loading walkthrough sits left of the grid
const LOADING_PANEL_W = 360

interface HoverInfo {
  x: number
  y: number
  commodity: string
  size: number
  dest: string
  color: string
}

function center(p: number, size: number, origin: number): number {
  return p + size / 2 - origin
}

type BoxMode = 'normal' | 'current' | 'loaded' | 'future'

function Box({
  pl,
  origin,
  grid,
  mode,
  onHover,
  onLeave
}: {
  pl: Placement
  origin: [number, number, number]
  grid: CargoGrid
  mode: BoxMode
  onHover: (h: Omit<HoverInfo, 'x' | 'y'>, e: ThreeEvent) => void
  onLeave: () => void
}): React.ReactElement {
  const wx = (grid.x || 0) + pl.x
  const wy = (grid.y || 0) + pl.y
  const wz = (grid.z || 0) + pl.z
  // gray loaded so only this stop carries colour
  const loaded = mode === 'loaded'
  const color = loaded ? '#6a7176' : pl.box.color
  const emissive = mode === 'current' ? 0.55 : loaded ? 0 : 0.18
  const opacity = mode === 'future' ? 0.12 : loaded ? 0.82 : 1
  return (
    <mesh
      position={[
        center(wx, pl.w, origin[0]),
        center(wy, pl.h, origin[1]),
        center(wz, pl.l, origin[2])
      ]}
      onPointerOver={(e) => {
        e.stopPropagation()
        onHover(
          { commodity: pl.box.commodity || '-', size: pl.box.size, dest: pl.box.dest, color: pl.box.color },
          e
        )
      }}
      onPointerOut={() => onLeave()}
    >
      <boxGeometry args={[pl.w - GAP, pl.h - GAP, pl.l - GAP]} />
      <meshStandardMaterial
        color={color}
        emissive={loaded ? '#000000' : pl.box.color}
        emissiveIntensity={emissive}
        roughness={0.55}
        metalness={0.1}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  )
}

function GridShell({
  grid,
  origin
}: {
  grid: CargoGrid
  origin: [number, number, number]
}): React.ReactElement {
  const refOnly = grid.autoLoad === false
  const geo = useMemo(() => new THREE.BoxGeometry(grid.w, grid.h, grid.l), [grid.w, grid.h, grid.l])
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo])
  const pos: [number, number, number] = [
    center(grid.x || 0, grid.w, origin[0]),
    center(grid.y || 0, grid.h, origin[1]),
    center(grid.z || 0, grid.l, origin[2])
  ]
  return (
    <group position={pos}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={refOnly ? C.amber : C.acc} transparent opacity={refOnly ? 0.5 : 0.32} />
      </lineSegments>
      {/* faint fill so empty bays show */}
      <mesh geometry={geo}>
        <meshBasicMaterial
          color={refOnly ? C.amber : C.acc}
          transparent
          opacity={refOnly ? 0.04 : 0.025}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

type ThreeEvent = { nativeEvent: PointerEvent; stopPropagation: () => void }

export default function CargoGridPage(): React.ReactElement {
  const contracts = useStore((s) => s.contracts)
  const order = useStore((s) => s.order)
  const layout = useStore((s) => s.layout)
  const route = useStore((s) => s.route)
  const activeShip = useStore((s) => s.settings.activeShip)
  const installedModules = useStore((s) => s.settings.installedModules)
  const lockLayout = useStore((s) => s.lockLayout)
  const unlockLayout = useStore((s) => s.unlockLayout)
  const turnInDestination = useStore((s) => s.turnInDestination)

  const locked = !!layout?.locked
  const installed = installedModules[activeShip]
  const grids = useMemo(() => gridsFor(activeShip, installed), [activeShip, installed])

  // loading-mode walkthrough state; also drives what the grid packs below. each
  // pickup stop fans out into one step per destination, deepest first.
  const liveSteps = useMemo(
    () => (route ? buildLoadingSteps(contracts, route, order) : []),
    [contracts, route, order]
  )
  const [loading, setLoading] = useState(false)
  const [loadIdx, setLoadIdx] = useState(0)
  // freeze the plan while walking it, so turning a stop in (which drops it from
  // the live route) can't shift or skip the remaining steps
  const [frozenSteps, setFrozenSteps] = useState<LoadingStep[] | null>(null)
  useEffect(() => {
    setFrozenSteps((prev) => (loading ? prev ?? liveSteps : null))
  }, [loading, liveSteps])
  const loadSteps = frozenSteps ?? liveSteps

  // objectives still aboard and undelivered; anything not here is done (delivered
  // or its contract archived), so a frozen drop step shows it as handed over
  const pendingObjIds = useMemo(
    () => new Set(contracts.flatMap((c) => c.objectives.filter((o) => !o.delivered).map((o) => o.id))),
    [contracts]
  )

  // portrait windows stack the walkthrough above the grid, landscape beside it
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setPortrait(window.innerHeight > window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // two-way sync with the overlay: we push our step, its PREV/NEXT push back.
  // skip the mount push so opening this page doesn't reset an overlay mid-load.
  const pushedOnce = useRef(false)
  useEffect(() => {
    if (!pushedOnce.current) {
      pushedOnce.current = true
      return
    }
    window.supercargo?.setLoadingState?.({ active: loading, idx: loadIdx })
  }, [loading, loadIdx])
  useEffect(
    () =>
      window.supercargo?.onLoadingState?.((s) => {
        setLoading(s.active)
        setLoadIdx(s.idx)
      }),
    []
  )

  // what the walkthrough has loaded so far. the grid packs exactly this set, so
  // it builds up as you load and only ever shrinks as you deliver - never re-
  // derived from the route, so re-planning can't make cargo vanish
  const aboardLoading = useMemo(() => {
    if (!loading || !loadSteps.length) return null
    const last = Math.min(loadIdx, loadSteps.length - 1)
    const ids = new Set<string>()
    for (let k = 0; k <= last; k++) for (const id of loadSteps[k].loadIds) ids.add(id)
    return ids
  }, [loading, loadIdx, loadSteps])

  // outside loading mode, scope the grid to the first trip so a multi-trip
  // manifest doesn't pack everything at once and read as over capacity
  const tripFilter = useMemo(() => (route ? firstTripFilter(route) : null), [route])
  const livePack = useMemo(() => {
    const all = packBoxes(contracts, order)
    if (aboardLoading) return all.filter((b) => aboardLoading.has(b.objectiveId))
    if (tripFilter) return all.filter((b) => tripFilter(b.objectiveId))
    return all
  }, [contracts, order, aboardLoading, tripFilter])
  // locked renders the stored positions verbatim - never re-pack, so frozen
  // cargo can't shuffle when a box drops out or a new one appears
  const result = useMemo(() => {
    if (locked) {
      const placements: Placement[] = []
      const unplaced: PackBox[] = []
      for (const b of layout!.boxes) {
        if (b.gridId != null && b.x != null) {
          placements.push({ box: b, gridId: b.gridId, x: b.x, y: b.y!, z: b.z!, w: b.w!, l: b.l!, h: b.h!, rotated: !!b.rotated })
        } else {
          unplaced.push(b)
        }
      }
      const capacity = grids.filter((g) => g.autoLoad !== false).reduce((a, g) => a + g.w * g.l * g.h, 0)
      return {
        placements,
        unplaced,
        grids: [],
        capacity,
        placedScu: placements.reduce((a, p) => a + p.box.size, 0),
        fits: unplaced.length === 0,
        squeezed: false
      }
    }
    return packCargo(grids, livePack)
  }, [locked, layout, grids, livePack])
  const deliveredIds = useMemo(
    () => (locked ? new Set(layout!.boxes.filter((b) => b.delivered).map((b) => b.id)) : null),
    [locked, layout]
  )
  const visiblePlacements = useMemo(
    () => (deliveredIds ? result.placements.filter((p) => !deliveredIds.has(p.box.id)) : result.placements),
    [result, deliveredIds]
  )
  const shownScu = useMemo(() => visiblePlacements.reduce((a, p) => a + p.box.size, 0), [visiblePlacements])
  const visibleCount = locked ? layout!.boxes.filter((b) => !b.delivered).length : livePack.length

  const sections = useMemo(() => {
    if (locked) {
      return layoutStops(layout!)
        .filter((s) => s.undelivered > 0)
        .map((s) => ({ idx: s.idx, code: s.code, name: s.name, color: s.color, refs: s.refs }))
    }
    const shownStops = new Set(livePack.map((b) => b.stopIdx))
    return deriveStops(contracts, order)
      .filter((s) => s.items.some((i) => !i.delivered) && shownStops.has(s.idx))
      .map((s) => ({
        idx: s.idx,
        code: s.code,
        name: s.name,
        color: s.color,
        refs: s.items
          .filter((i) => !i.delivered)
          .map((i) => ({ contractId: i.contractId, objectiveId: i.objectiveId }))
      }))
  }, [locked, layout, contracts, order, livePack])

  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const toggleHidden = (idx: number): void =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  // bounds over all grids so ref-only bays get framed
  const { origin, span } = useMemo(() => {
    if (!grids.length) return { origin: [0, 0, 0] as [number, number, number], span: 10 }
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (const g of grids) {
      minX = Math.min(minX, g.x || 0); maxX = Math.max(maxX, (g.x || 0) + g.w)
      minY = Math.min(minY, g.y || 0); maxY = Math.max(maxY, (g.y || 0) + g.h)
      minZ = Math.min(minZ, g.z || 0); maxZ = Math.max(maxZ, (g.z || 0) + g.l)
    }
    const o: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
    return { origin: o, span: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 6) }
  }, [grids])

  const done = loading && loadIdx >= loadSteps.length
  const currentLoad = loading && !done ? loadSteps[loadIdx] : undefined
  const currentObjIds = useMemo(
    () => new Set([...(currentLoad?.loadIds ?? []), ...(currentLoad?.dropIds ?? [])]),
    [currentLoad]
  )
  // only the aboard set is packed while loading, so everything shown is either
  // this stop's action (glowing) or already on board (gray) - never future
  const boxMode = (objectiveId?: string): BoxMode => {
    if (!loading) return 'normal'
    if (objectiveId && currentObjIds.has(objectiveId)) return 'current'
    return 'loaded'
  }
  const startLoading = (): void => {
    setLoadIdx(0)
    setLoading(true)
  }

  const gridById = useMemo(() => new Map(grids.map((g) => [g.id, g])), [grids])
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  const onHover = (h: Omit<HoverInfo, 'x' | 'y'>, e: ThreeEvent): void => {
    const r = wrap.current?.getBoundingClientRect()
    setHover({ ...h, x: e.nativeEvent.clientX - (r?.left ?? 0), y: e.nativeEvent.clientY - (r?.top ?? 0) })
  }

  if (visibleCount === 0) {
    return (
      <div style={{ padding: PAGE_PADDING }}>
        <PageHeader title="CARGO GRID" subtitle={`${activeShip} · 3D load plan`} />
        <Placeholder
          phase="Cargo Grid"
          lines={[
            'No active cargo to lay out yet. Add contracts on the Manifest, then come back',
            'here to see every box placed in the ship in delivery order, first drop-off on top.'
          ]}
        />
      </div>
    )
  }

  const camDist = span * 1.6
  const over = result.unplaced.length > 0

  return (
    <div style={{ padding: PAGE_PADDING, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <PageHeader title="CARGO GRID" subtitle={`${activeShip} · current load`} />

      <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', flexWrap: 'wrap', margin: '2px 0 10px' }}>
        <Stat label="LOADED" value={`${fmt(shownScu)} / ${fmt(result.capacity)} SCU`} />
        <Stat label="BOXES" value={`${fmt(visiblePlacements.length)}${over ? ` (+${result.unplaced.length} won't fit)` : ''}`} color={over ? C.red : undefined} />
        <Stat label="BAYS" value={String(grids.filter((g) => g.autoLoad !== false).length)} />
        <span
          style={{ fontFamily: F.body, fontSize: 13, color: over ? C.red : C.green, textShadow: GLOW }}
          title={result.squeezed ? 'Everything fits, but the roomy per-stop spacing ran out, so the boxes are packed tight.' : undefined}
        >
          {over
            ? '▲ OVER CAPACITY (overflow not shown)'
            : result.squeezed
              ? '✓ FITS · PACKED TIGHT'
              : '✓ EVERYTHING FITS'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {!loading && (
            <Btn
              onClick={() => (locked ? unlockLayout() : lockLayout())}
              title={
                locked
                  ? 'Layout is frozen - positions stay put as you turn in. Click to go back to a live plan.'
                  : 'Freeze the current layout so boxes stop moving as you deliver.'
              }
              style={{
                border: `1px solid ${locked ? C.acc : C.lineStrong}`,
                background: locked ? C.accFill : 'transparent',
                color: locked ? C.text : C.dim,
                fontFamily: F.display,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.14em',
                padding: '6px 12px',
                cursor: 'pointer'
              }}
              hoverStyle={{ color: C.text, borderColor: C.acc }}
            >
              {locked ? '◆ LAYOUT LOCKED' : 'LOCK LAYOUT'}
            </Btn>
          )}
          {!locked && loadSteps.length > 0 && (
            <Btn
              onClick={() => (loading ? setLoading(false) : startLoading())}
              style={{
                border: `1px solid ${loading ? C.acc : C.lineStrong}`,
                background: loading ? C.accFill : 'transparent',
                color: loading ? C.text : C.dim,
                fontFamily: F.display,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.14em',
                padding: '6px 12px',
                cursor: 'pointer'
              }}
              hoverStyle={{ color: C.text, borderColor: C.acc }}
            >
              {loading ? '✕ EXIT LOADING' : '▶ LOADING MODE'}
            </Btn>
          )}
          {!loading && (
            <span style={{ fontFamily: F.body, fontSize: 12, color: C.ghost }}>
              drag to orbit · hover a box
            </span>
          )}
        </div>
      </div>

      {!loading && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
        {sections.map((s) => {
          const off = hidden.has(s.idx)
          return (
            <span
              key={s.idx}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: F.body,
                fontSize: 12,
                color: off ? C.ghost : C.dim,
                border: `1px solid ${C.lineSoft}`,
                borderRadius: 4,
                padding: '3px 6px'
              }}
            >
              <button
                onClick={() => toggleHidden(s.idx)}
                title={off ? 'Show this stop' : 'Hide this stop (see underneath)'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0 }}
              >
                <span style={{ width: 11, height: 11, background: off ? 'transparent' : s.color, border: `1px solid ${s.color}`, borderRadius: 2, boxShadow: off ? 'none' : GLOW }} />
                {s.idx + 1}. {s.code || s.name}
                {off && <span style={{ color: C.ghost, fontSize: 11 }}>(hidden)</span>}
              </button>
            </span>
          )
        })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: portrait ? 'column' : 'row', gap: 10, flex: 1, minHeight: 0 }}>
        {loading && (
          <div
            style={
              portrait
                ? { flex: 'none', height: 300, maxHeight: '45%', minHeight: 0 }
                : { flex: 'none', width: LOADING_PANEL_W, minHeight: 0 }
            }
          >
            <LoadingPanel
              key={`${currentLoad?.kind ?? 'done'}-${loadIdx}`}
              step={currentLoad}
              aboardScu={shownScu}
              done={done}
              idx={loadIdx}
              total={loadSteps.length}
              pendingObjIds={pendingObjIds}
              onTurnIn={(entries) => turnInDestination(entries)}
              onLoaded={() => setLoadIdx((i) => i + 1)}
              onBack={() => setLoadIdx((i) => Math.max(0, i - 1))}
              onExit={() => setLoading(false)}
              onFinish={() => {
                lockLayout()
                setLoading(false)
              }}
            />
          </div>
        )}
        <div
          ref={wrap}
          style={{ position: 'relative', flex: 1, minHeight: portrait ? 200 : 320, border: `1px solid ${C.line}`, borderRadius: 6, overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 40%, #06090b, #000)' }}
        >
        <Canvas key={activeShip} camera={{ position: [camDist, camDist * 0.8, camDist], fov: 45 }}>
          <ambientLight intensity={0.75} />
          <directionalLight position={[span, span * 1.5, span]} intensity={1.1} />
          <directionalLight position={[-span, span, -span]} intensity={0.4} />
          {grids.map((g) => (
            <GridShell key={g.id} grid={g} origin={origin} />
          ))}
          {visiblePlacements.map((pl) => {
            const g = gridById.get(pl.gridId)
            if (!g) return null
            if (!loading && hidden.has(pl.box.stopIdx)) return null
            const mode = boxMode(pl.box.objectiveId)
            // hide future cargo, keeps grid readable
            if (loading && mode === 'future') return null
            return (
              <Box
                key={pl.box.id}
                pl={pl}
                grid={g}
                origin={origin}
                mode={mode}
                onHover={onHover}
                onLeave={() => setHover(null)}
              />
            )
          })}
          <OrbitControls makeDefault enablePan target={[0, 0, 0]} />
        </Canvas>

        {hover && (
          <div
            style={{
              position: 'absolute',
              left: hover.x + 14,
              top: hover.y + 14,
              pointerEvents: 'none',
              background: 'rgba(0,0,0,0.88)',
              border: `1px solid ${hover.color}`,
              borderRadius: 4,
              padding: '6px 9px',
              fontFamily: F.body,
              fontSize: 13,
              color: C.text,
              whiteSpace: 'nowrap',
              boxShadow: GLOW
            }}
          >
            <div style={{ fontWeight: 600 }}>{hover.commodity}</div>
            <div style={{ color: C.dim, fontSize: 12 }}>
              {hover.size} SCU · {hover.dest}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

type TurnMode = 'full' | 'part' | 'none'
type TurnInEntry = { contractId: string; objectiveId: string; deliveredScu: number }

function LoadingPanel({
  step,
  aboardScu,
  done,
  idx,
  total,
  pendingObjIds,
  onTurnIn,
  onLoaded,
  onBack,
  onExit,
  onFinish
}: {
  step: LoadingStep | undefined
  aboardScu: number
  done: boolean
  idx: number
  total: number
  pendingObjIds: Set<string>
  onTurnIn: (entries: TurnInEntry[]) => void
  onLoaded: () => void
  onBack: () => void
  onExit: () => void
  onFinish: () => void
}): React.ReactElement {
  const isDrop = step?.kind === 'drop'
  // objectives at this drop that still need turning in
  const pending = isDrop ? step!.lines.filter((l) => pendingObjIds.has(l.objectiveId)) : []
  const [rows, setRows] = useState<Record<string, { mode: TurnMode; amount: number }>>(() =>
    Object.fromEntries(pending.map((l) => [l.objectiveId, { mode: 'full' as TurnMode, amount: l.scu }]))
  )
  const setMode = (l: LoadingStep['lines'][number], mode: TurnMode): void =>
    setRows((r) => {
      const cur = r[l.objectiveId]?.amount ?? l.scu
      const amount =
        mode === 'full' ? l.scu : mode === 'none' ? 0 : cur > 0 && cur < l.scu ? cur : Math.max(1, Math.round(l.scu / 2))
      return { ...r, [l.objectiveId]: { mode, amount } }
    })
  const setAmount = (l: LoadingStep['lines'][number], amount: number): void =>
    setRows((r) => ({ ...r, [l.objectiveId]: { mode: 'part', amount: Math.max(0, Math.min(l.scu, amount)) } }))

  const navBtn = (label: string, onClick: () => void, disabled?: boolean): React.ReactElement => (
    <Btn
      onClick={onClick}
      disabled={disabled}
      style={{ border: `1px solid ${C.lineStrong}`, background: 'transparent', color: disabled ? C.ghost : C.dim, cursor: disabled ? 'default' : 'pointer', fontFamily: F.display, fontSize: 12, letterSpacing: '0.1em', padding: '8px 12px' }}
      hoverStyle={disabled ? {} : { color: C.text, borderColor: C.acc }}
    >
      {label}
    </Btn>
  )

  if (done || !step) {
    return (
      <div style={{ border: `1px solid ${C.green}`, borderRadius: 6, padding: '14px 16px', height: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontFamily: F.display, fontSize: 14, fontWeight: 600, letterSpacing: '0.1em', color: C.green, textShadow: GLOW }}>
          ✓ ROUTE WALKED · {total} STEPS
        </span>
        <span style={{ fontFamily: F.body, fontSize: 12.5, color: C.dim }}>
          Load at pickups, deliver along the way. Lock the layout to freeze it.
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          {navBtn('‹ BACK', onBack, idx === 0)}
          {navBtn('DONE · LOCK LAYOUT', onFinish)}
        </span>
      </div>
    )
  }

  const isLoad = step.kind === 'load'
  const dest = splitDestination(step.boundFor)
  const destLabel = dest.code ? `${dest.code} · ${dest.name}` : dest.name || step.boundFor
  const title = isLoad ? `LOAD → ${destLabel}` : `DELIVER → ${destLabel}`

  const submit = (): void => {
    if (pending.length) {
      onTurnIn(
        pending.map((l) => {
          const st = rows[l.objectiveId] ?? { mode: 'full' as TurnMode, amount: l.scu }
          const deliveredScu =
            st.mode === 'full' ? l.scu : st.mode === 'none' ? 0 : Math.max(0, Math.min(l.scu, Math.round(st.amount || 0)))
          return { contractId: l.contractId, objectiveId: l.objectiveId, deliveredScu }
        })
      )
    }
    onLoaded()
  }

  const actionLabel = isLoad ? 'LOADED ✓ · NEXT' : pending.length ? 'TURN IN ✓ · NEXT' : 'DELIVERED ✓ · NEXT'

  return (
    <div style={{ border: `1px solid ${C.acc}`, borderRadius: 6, background: C.accFill, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', padding: '14px 16px 10px', flex: 'none' }}>
        <span style={{ fontFamily: F.display, fontSize: 12, letterSpacing: '0.18em', color: C.acc }}>
          STEP {idx + 1} / {total}
        </span>
        <span style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600, color: C.text, textShadow: GLOW }}>
          {step.code ? `${step.code} · ` : ''}{step.label}
        </span>
        {isLoad && step.groupTotal > 1 && (
          <span style={{ fontFamily: F.body, fontSize: 12, color: C.amber }}>
            group {step.groupPos}/{step.groupTotal} · {step.placement}
          </span>
        )}
        <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>{fmt(aboardScu)} SCU aboard</span>
        <span style={{ marginLeft: 'auto', fontFamily: F.body, fontSize: 12, color: C.ghost }}>
          {isLoad ? "the glowing cargo is this step's" : 'mark what you handed over'}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px' }}>
        <LoadSection title={title} color={isLoad ? C.green : C.acc}>
          {step.lines.map((l) =>
            isLoad ? (
              <LoadLineRow key={l.objectiveId} line={l} />
            ) : (
              <DropLineRow
                key={l.objectiveId}
                line={l}
                delivered={!pendingObjIds.has(l.objectiveId)}
                row={rows[l.objectiveId] ?? { mode: 'full', amount: l.scu }}
                onMode={(m) => setMode(l, m)}
                onAmount={(a) => setAmount(l, a)}
              />
            )
          )}
        </LoadSection>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '10px 16px 14px', flex: 'none', borderTop: `1px solid ${C.lineFaint}` }}>
        {navBtn('‹ BACK', onBack, idx === 0)}
        <Btn
          onClick={isDrop ? submit : onLoaded}
          style={{ flex: 1, border: `1px solid ${C.acc}`, background: C.accFillStrong, color: C.text, textShadow: GLOW, fontFamily: F.display, fontSize: 13, fontWeight: 600, letterSpacing: '0.16em', padding: 11, cursor: 'pointer' }}
          hoverStyle={{ background: 'rgba(255,210,30,0.26)' }}
        >
          {actionLabel}
        </Btn>
        {navBtn('EXIT', onExit)}
      </div>
    </div>
  )
}

function LoadSection({ title, color, children }: { title: string; color: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ borderTop: `1px solid ${C.lineFaint}`, paddingTop: 9, marginTop: 4 }}>
      <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

function LoadLineRow({ line }: { line: LoadingStep['lines'][number] }): React.ReactElement {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.acc }}>{line.ref}</span>
        {line.tell ? (
          <span style={{ fontFamily: F.body, fontSize: 13, color: C.textBody }}>
            find the contract with <b style={{ color: C.text }}>{line.tell}</b>
          </span>
        ) : (
          <span style={{ fontFamily: F.body, fontSize: 13, color: C.amber }}>⚠ no unique tell, match by full box set</span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', paddingLeft: 4, alignItems: 'baseline' }}>
        <span style={{ fontFamily: F.mono, fontSize: 13, color: C.text }}>{line.breakdown}</span>
        <span style={{ fontFamily: F.body, fontSize: 13, color: C.dim }}>{line.commodity}</span>
        {line.multiPickup && (
          <span style={{ fontFamily: F.body, fontSize: 11, color: C.amber }}>(split pickup: load what&apos;s here)</span>
        )}
      </div>
    </div>
  )
}

function DropLineRow({
  line,
  delivered,
  row,
  onMode,
  onAmount
}: {
  line: LoadingStep['lines'][number]
  delivered: boolean
  row: { mode: TurnMode; amount: number }
  onMode: (mode: TurnMode) => void
  onAmount: (amount: number) => void
}): React.ReactElement {
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'baseline' }}>
        <span style={{ fontFamily: F.mono, fontSize: 13, color: C.text }}>{line.breakdown}</span>
        <span style={{ fontFamily: F.body, fontSize: 13, color: C.dim }}>{line.commodity}</span>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.ghost }}>[{line.ref}]</span>
      </div>
      {delivered ? (
        <div style={{ fontFamily: F.body, fontSize: 12.5, color: C.green, marginTop: 3 }}>✓ delivered</div>
      ) : (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
          <Seg label="FULL" color={C.green} active={row.mode === 'full'} onClick={() => onMode('full')} />
          <Seg label="PARTIAL" color={C.amber} active={row.mode === 'part'} onClick={() => onMode('part')} />
          <Seg label="NONE" color={C.red} active={row.mode === 'none'} onClick={() => onMode('none')} />
          {row.mode === 'part' ? (
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
              <input
                value={row.amount || ''}
                onChange={(e) => onAmount(parseInt(e.target.value.replace(/[^0-9]/g, '') || '0', 10) || 0)}
                inputMode="numeric"
                style={{ width: 52, background: 'transparent', border: 0, borderBottom: `1px solid rgba(255,255,255,0.25)`, color: C.text, fontFamily: F.mono, fontSize: 13, textAlign: 'right', padding: '2px 0', outline: 'none' }}
              />
              <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>/ {line.scu} SCU</span>
            </span>
          ) : (
            <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>
              {row.mode === 'full' ? line.scu : 0} / {line.scu} SCU
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function Seg({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{ border: `1px solid ${active ? color : C.lineSoft}`, background: active ? 'rgba(255,255,255,0.05)' : 'transparent', color: active ? color : C.dim, fontFamily: F.display, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', padding: '4px 8px', cursor: 'pointer' }}
      hoverStyle={{ border: `1px solid ${color}`, color }}
    >
      {label}
    </Btn>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }): React.ReactElement {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7 }}>
      <span style={{ fontFamily: F.body, fontSize: 11, letterSpacing: 1, color: C.ghost }}>{label}</span>
      <span style={{ fontFamily: F.mono, fontSize: 15, color: color || C.text, textShadow: GLOW }}>{value}</span>
    </span>
  )
}
