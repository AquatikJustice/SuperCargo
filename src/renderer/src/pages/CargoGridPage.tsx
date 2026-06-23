import React, { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useStore } from '../state/store'
import { C, F, GLOW, fmt } from '../theme'
import { packBoxes, deriveStops } from '../state/manifest'
import { layoutStops } from '../state/layout'
import { buildLoadingPlan, type LoadStop } from '../state/loading'
import { gridsFor, type CargoGrid } from '@shared/cargoGrids'
import { packCargo, type Placement, type PackBox } from '@shared/packer'
import { Btn } from '../components/ui'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import Placeholder from '../components/Placeholder'

// 1 grid cell (1.25 m / 1 SCU cube) = 1 three.js unit. A small gap keeps stacked
// boxes apart so you can see each one.
const GAP = 0.08

interface HoverInfo {
  x: number
  y: number
  commodity: string
  size: number
  dest: string
  color: string
}

/** Center of a box covering cells [p, p+size), in scene space (minus origin). */
function center(p: number, size: number, origin: number): number {
  return p + size / 2 - origin
}

// In Loading Mode: 'current' = the destination you're loading now (bright),
// 'loaded' = already placed (dimmed), 'future' = not yet (ghosted).
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
  const emissive = mode === 'current' ? 0.55 : mode === 'future' ? 0 : 0.18
  const opacity = mode === 'future' ? 0.12 : mode === 'loaded' ? 0.5 : 1
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
        color={pl.box.color}
        emissive={pl.box.color}
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
      {/* faint floor fill so empty bays look like solid volumes */}
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

// small local alias for the fiber pointer event we use
type ThreeEvent = { nativeEvent: PointerEvent; stopPropagation: () => void }

export default function CargoGridPage(): React.ReactElement {
  const contracts = useStore((s) => s.contracts)
  const order = useStore((s) => s.order)
  const layout = useStore((s) => s.layout)
  const activeShip = useStore((s) => s.settings.activeShip)
  const installedModules = useStore((s) => s.settings.installedModules)
  const setObjectivesDelivered = useStore((s) => s.setObjectivesDelivered)
  const lockLayout = useStore((s) => s.lockLayout)
  const unlockLayout = useStore((s) => s.unlockLayout)

  const locked = !!layout?.locked
  const installed = installedModules[activeShip]
  const grids = useMemo(() => gridsFor(activeShip, installed), [activeShip, installed])

  // Box source: a locked layout is fixed - delivered boxes stay in the pack so
  // nothing slides into their cell, but they're hidden from the view. Unlocked is
  // the live plan that re-flows as the manifest and route change.
  const livePack = useMemo(() => packBoxes(contracts, order), [contracts, order])
  const packInput: PackBox[] = locked ? layout!.boxes : livePack
  const result = useMemo(() => packCargo(grids, packInput), [grids, packInput])
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

  // Sections still carrying cargo, unified across locked/unlocked, each carrying the
  // objective refs behind it (for the quick "mark this stop delivered" check).
  const sections = useMemo(() => {
    if (locked) {
      return layoutStops(layout!)
        .filter((s) => s.undelivered > 0)
        .map((s) => ({ idx: s.idx, code: s.code, name: s.name, color: s.color, refs: s.refs }))
    }
    return deriveStops(contracts, order)
      .filter((s) => s.items.some((i) => !i.delivered))
      .map((s) => ({
        idx: s.idx,
        code: s.code,
        name: s.name,
        color: s.color,
        refs: s.items
          .filter((i) => !i.delivered)
          .map((i) => ({ contractId: i.contractId, objectiveId: i.objectiveId }))
      }))
  }, [locked, layout, contracts, order])

  // Per-destination visibility (view only, lets you peek under a layer while loading).
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const toggleHidden = (idx: number): void =>
    setHidden((prev) => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  // Quick "I dropped this whole stop" = a full turn-in. Locks the layout first
  // (no-op if already locked) so the rest stays put instead of re-flowing.
  const markDone = (stopIdx: number): void => {
    const sec = sections.find((s) => s.idx === stopIdx)
    if (!sec) return
    lockLayout()
    setObjectivesDelivered(sec.refs, true)
  }

  // scene bounds across ALL grids (so reference-only bays are framed too)
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

  // --- Loading Mode: step through loading one destination at a time ---
  const loadPlan = useMemo(() => buildLoadingPlan(contracts, order), [contracts, order])
  const [loading, setLoading] = useState(false)
  const [loadIdx, setLoadIdx] = useState(0)
  const done = loading && loadIdx >= loadPlan.length
  const currentLoad = loading && !done ? loadPlan[loadIdx] : undefined
  const loadedIdxs = useMemo(
    () => new Set(loadPlan.slice(0, loadIdx).map((s) => s.idx)),
    [loadPlan, loadIdx]
  )
  const boxMode = (stopIdx: number): BoxMode => {
    if (!loading) return 'normal'
    if (currentLoad && stopIdx === currentLoad.idx) return 'current'
    if (loadedIdxs.has(stopIdx)) return 'loaded'
    return 'future'
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
      <PageHeader title="CARGO GRID" subtitle={`${activeShip} · 3D load plan`} />

      <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', flexWrap: 'wrap', margin: '2px 0 10px' }}>
        <Stat label="LOADED" value={`${fmt(shownScu)} / ${fmt(result.capacity)} SCU`} />
        <Stat label="BOXES" value={`${fmt(visiblePlacements.length)}${over ? ` (+${result.unplaced.length} won't fit)` : ''}`} color={over ? C.red : undefined} />
        <Stat label="BAYS" value={String(grids.filter((g) => g.autoLoad !== false).length)} />
        <span style={{ fontFamily: F.body, fontSize: 13, color: over ? C.red : C.green, textShadow: GLOW }}>
          {over ? '▲ OVER CAPACITY (overflow not shown)' : '✓ EVERYTHING FITS'}
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
          {!locked && loadPlan.length > 0 && (
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

      {loading ? (
        <LoadingPanel
          stop={currentLoad}
          done={done}
          idx={loadIdx}
          total={loadPlan.length}
          onLoaded={() => setLoadIdx((i) => i + 1)}
          onBack={() => setLoadIdx((i) => Math.max(0, i - 1))}
          onExit={() => setLoading(false)}
          onFinish={() => {
            lockLayout()
            setLoading(false)
          }}
        />
      ) : (
        /* legend: click a swatch to show or hide that stop's boxes, click the check to mark it delivered */
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
              <button
                onClick={() => markDone(s.idx)}
                title="Mark this destination delivered (removes its boxes)"
                style={{ background: 'transparent', border: 0, cursor: 'pointer', color: C.green, padding: '0 2px', fontSize: 13, lineHeight: 1 }}
              >
                ✓
              </button>
            </span>
          )
        })}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: F.body, fontSize: 12, color: C.amber }}>
          <span style={{ width: 11, height: 11, border: `1px solid ${C.amber}`, borderRadius: 2 }} /> reference only
        </span>
        </div>
      )}

      <div
        ref={wrap}
        style={{ position: 'relative', flex: 1, minHeight: 320, border: `1px solid ${C.line}`, borderRadius: 6, overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 40%, #06090b, #000)' }}
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
            return (
              <Box
                key={pl.box.id}
                pl={pl}
                grid={g}
                origin={origin}
                mode={boxMode(pl.box.stopIdx)}
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
  )
}

// One loading step for a destination: which boxes to pull from the FE (grouped by
// contract, each labeled with its unique "tell") and load into the glowing section.
function LoadingPanel({
  stop,
  done,
  idx,
  total,
  onLoaded,
  onBack,
  onExit,
  onFinish
}: {
  stop: LoadStop | undefined
  done: boolean
  idx: number
  total: number
  onLoaded: () => void
  onBack: () => void
  onExit: () => void
  /** Finished the walkthrough: lock the layout and leave loading mode. */
  onFinish: () => void
}): React.ReactElement {
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

  if (done || !stop) {
    return (
      <div style={{ border: `1px solid ${C.green}`, borderRadius: 6, padding: '14px 16px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontFamily: F.display, fontSize: 14, fontWeight: 600, letterSpacing: '0.1em', color: C.green, textShadow: GLOW }}>
          ✓ ALL {total} DESTINATIONS LOADED
        </span>
        <span style={{ fontFamily: F.body, fontSize: 12.5, color: C.dim }}>
          Cargo is grouped by destination. At each stop, unload just that section.
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          {navBtn('‹ BACK', onBack, idx === 0)}
          {navBtn('DONE · LOCK LAYOUT', onFinish)}
        </span>
      </div>
    )
  }

  return (
    <div style={{ border: `1px solid ${C.acc}`, borderRadius: 6, padding: '14px 16px', marginBottom: 8, background: C.accFill }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontFamily: F.display, fontSize: 12, letterSpacing: '0.18em', color: C.acc }}>
          LOADING {idx + 1} / {total}
        </span>
        <span style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600, color: C.text, textShadow: GLOW }}>
          {stop.code ? `${stop.code} · ` : ''}{stop.name}
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>
          {stop.boxCount} boxes · {fmt(stop.scu)} SCU
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: F.body, fontSize: 12, color: C.ghost }}>
          load into the glowing section
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {stop.groups.map((g) => (
          <div key={g.contractId} style={{ borderTop: `1px solid ${C.lineFaint}`, paddingTop: 9 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ fontFamily: F.mono, fontSize: 11, color: C.acc }}>{g.ref}</span>
              {g.tell ? (
                <span style={{ fontFamily: F.body, fontSize: 13, color: C.textBody }}>
                  find the contract with <b style={{ color: C.text }}>{g.tell}</b>
                </span>
              ) : (
                <span style={{ fontFamily: F.body, fontSize: 13, color: C.amber }}>
                  ⚠ no unique tell, match by full box set
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', paddingLeft: 4 }}>
              {g.stacks.map((s, k) => (
                <span key={k} style={{ fontFamily: F.body, fontSize: 13, color: C.body }}>
                  <span style={{ fontFamily: F.mono, color: C.text }}>{s.breakdown}</span>{' '}
                  <span style={{ color: C.dim }}>{s.commodity}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {navBtn('‹ BACK', onBack, idx === 0)}
        <Btn
          onClick={onLoaded}
          style={{ flex: 1, border: `1px solid ${C.acc}`, background: C.accFillStrong, color: C.text, textShadow: GLOW, fontFamily: F.display, fontSize: 13, fontWeight: 600, letterSpacing: '0.16em', padding: 11, cursor: 'pointer' }}
          hoverStyle={{ background: 'rgba(255,210,30,0.26)' }}
        >
          LOADED ✓ · NEXT DESTINATION
        </Btn>
        {navBtn('EXIT', onExit)}
      </div>
    </div>
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
