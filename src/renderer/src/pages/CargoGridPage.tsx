import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Text, RoundedBox, Edges } from '@react-three/drei'
import sairaFont from '@fontsource/saira/files/saira-latin-600-normal.woff?url'
import jetbrainsFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff?url'
import { useStore } from '../state/store'
import { C, F, GLOW, fmt, stopColor } from '../theme'
import { packBoxes, deriveStops } from '../state/manifest'
import { buildLoadingSteps, type LoadingStep } from '../state/loading'
import { firstTripBudget } from '../state/route'
import { splitDestination } from '../data/stations'
import { gridsFor, shipFrame, isSecureBay, type CargoGrid } from '@shared/cargoGrids'
import type { BayDir } from '@shared/types'
import { packCargo, packTimeline, packInto, provePeel, type Placement, type PackBox, type LoadEvent, type Occupied } from '@shared/packer'
import { BOX_DIMS } from '@shared/boxGeometry'
import type { FrozenBox, GridView } from '@shared/types'
import { Btn } from '../components/ui'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import Placeholder from '../components/Placeholder'
import TurnInModal, { type TurnInItem } from '../components/TurnInModal'

const GAP = 0.08

const BOX_GRAY = '#787d82'
const BOX_GRAY_LOADED = '#5b6065'
const STRIPE_T = 0.3
const STRIPE_MARGIN = 0.06
const STRIPE_PROUD = 0.012 // past the face, no z-fight

const locationFont = jetbrainsFont

const LOADING_PANEL_W = 360

const STBD_OF: Record<BayDir, BayDir> = { 'z-': 'x+', 'z+': 'x-', 'x+': 'z+', 'x-': 'z-', 'y+': 'x+', 'y-': 'x+' }
const OPP: Record<BayDir, BayDir> = { 'x+': 'x-', 'x-': 'x+', 'y+': 'y-', 'y-': 'y+', 'z+': 'z-', 'z-': 'z+' }

function OrientationLabels({
  frame,
  half
}: {
  frame?: { fore: BayDir; starboard: BayDir }
  half: [number, number, number]
}): React.ReactElement {
  const fore = frame?.fore ?? 'z-'
  const starboard = frame?.starboard ?? STBD_OF[fore]
  const [hx, hy, hz] = half
  const size = Math.min(4, Math.max(1.2, Math.max(hx, hz) * 0.12))
  const off = size * 1.1 + 0.6
  const floorY = -hy
  const pos = (d: BayDir): [number, number, number] => {
    switch (d) {
      case 'x+': return [hx + off, floorY, 0]
      case 'x-': return [-hx - off, floorY, 0]
      case 'z+': return [0, floorY, hz + off]
      case 'z-': return [0, floorY, -hz - off]
      default: return [0, floorY, 0]
    }
  }
  // upright per world edge
  const IN_PLANE: Record<BayDir, number> = {
    'z-': Math.PI, 'z+': 0, 'x+': Math.PI / 2, 'x-': -Math.PI / 2, 'y+': 0, 'y-': 0
  }
  const labels: Array<[BayDir, string]> = [
    [fore, 'FRONT'],
    [OPP[fore], 'REAR'],
    [starboard, 'STARBOARD'],
    [OPP[starboard], 'PORT']
  ]
  return (
    <>
      {labels.map(([d, text]) => (
        <Text
          key={text}
          font={sairaFont}
          position={pos(d)}
          rotation={[-Math.PI / 2, 0, IN_PLANE[d]]}
          fontSize={size}
          color={C.amber}
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.12}
          outlineWidth={size * 0.03}
          outlineColor="#000"
        >
          {text}
        </Text>
      ))}
    </>
  )
}

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
  label,
  draggable,
  onStart,
  onReset,
  onDragMove,
  onHover,
  onLeave
}: {
  pl: Placement
  origin: [number, number, number]
  grid: CargoGrid
  mode: BoxMode
  label?: string
  draggable?: boolean
  onStart?: () => void
  onReset?: () => void
  onDragMove?: (shipX: number, shipZ: number) => void
  onHover: (h: Omit<HoverInfo, 'x' | 'y'>, e: ThreeEvent) => void
  onLeave: () => void
}): React.ReactElement {
  const wx = (grid.x || 0) + pl.x
  const wy = (grid.y || 0) + pl.y
  const wz = (grid.z || 0) + pl.z
  const cx = center(wx, pl.w, origin[0])
  const cy = center(wy, pl.h, origin[1])
  const cz = center(wz, pl.l, origin[2])
  const loaded = mode === 'loaded'
  const color = loaded ? BOX_GRAY_LOADED : BOX_GRAY
  const stripeColor = loaded ? BOX_GRAY_LOADED : pl.box.color
  const emissive = mode === 'current' ? 0.12 : 0
  const opacity = mode === 'future' ? 0.12 : loaded ? 0.82 : 1
  const W = pl.w - GAP
  const H = pl.h - GAP
  const L = pl.l - GAP
  // separates adjacent boxes
  const bevel = Math.min(0.09, Math.min(W, H, L) / 2 - 0.02)
  const halfH = H / 2
  const belts = [{ y: halfH - STRIPE_MARGIN - STRIPE_T / 2, t: STRIPE_T }]
  return (
    <group>
      <RoundedBox
        args={[W, H, L]}
        radius={bevel}
        smoothness={3}
        steps={1}
        castShadow
        receiveShadow
        position={[cx, cy, cz]}
        onPointerOver={(e) => {
          e.stopPropagation()
          onHover(
            { commodity: pl.box.commodity || '-', size: pl.box.size, dest: pl.box.dest, color: pl.box.color },
            e
          )
        }}
        onPointerOut={() => onLeave()}
        onPointerMove={
          onDragMove
            ? (e) => {
                e.stopPropagation()
                onDragMove(e.point.x + origin[0], e.point.z + origin[2])
              }
            : undefined
        }
        onPointerDown={
          draggable
            ? (e) => {
                e.stopPropagation()
                onStart?.()
              }
            : undefined
        }
        onDoubleClick={
          draggable
            ? (e) => {
                e.stopPropagation()
                onReset?.()
              }
            : undefined
        }
      >
        <meshStandardMaterial
          color={color}
          emissive={loaded ? '#000000' : pl.box.color}
          emissiveIntensity={emissive}
          roughness={0.95}
          metalness={0}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </RoundedBox>
      {belts.map((b, i) => (
        <RoundedBox
          key={`belt-${i}`}
          args={[W + STRIPE_PROUD * 2, b.t, L + STRIPE_PROUD * 2]}
          radius={Math.min(0.08, b.t * 0.45, bevel)}
          smoothness={2}
          steps={1}
          position={[cx, cy + b.y, cz]}
          receiveShadow
          raycast={() => null}
        >
          <meshStandardMaterial
            color={stripeColor}
            emissive={mode === 'current' ? pl.box.color : '#000000'}
            emissiveIntensity={emissive}
            roughness={0.85}
            metalness={0}
            transparent={opacity < 1}
            opacity={opacity}
          />
        </RoundedBox>
      ))}
      {!label &&
        mode !== 'future' &&
        (() => {
          const sd = splitDestination(pl.box.dest)
          const loc = sd.code || sd.name
          if (!loc) return null
          const bandBottom = belts[0].y - STRIPE_T / 2
          const lowY = (bandBottom - halfH) / 2
          const availH = bandBottom + halfH
          const eps = 0.015
          const hw = W / 2
          const hl = L / 2
          // big as fits, capped
          const fit = (fw: number): number =>
            Math.min(0.34, availH * 0.8, (fw * 0.92) / Math.max(3, loc.length * 0.62))
          const faces: Array<[[number, number, number], [number, number, number], number]> = [
            [[cx, cy + lowY, cz + hl + eps], [0, 0, 0], W],
            [[cx, cy + lowY, cz - hl - eps], [0, Math.PI, 0], W],
            [[cx + hw + eps, cy + lowY, cz], [0, Math.PI / 2, 0], L],
            [[cx - hw - eps, cy + lowY, cz], [0, -Math.PI / 2, 0], L]
          ]
          return faces.map(([p, r, fw], i) => {
            const fs = fit(fw)
            return (
              <Text
                key={`loc-${i}`}
                font={locationFont}
                position={p}
                rotation={r}
                fontSize={fs}
                anchorX="center"
                anchorY="middle"
              >
                {loc}
                <meshStandardMaterial
                  color="#cfd2d4"
                  emissive="#cfd2d4"
                  emissiveIntensity={0.1}
                  roughness={0.9}
                  metalness={0}
                  transparent
                  opacity={0.92}
                />
              </Text>
            )
          })
        })()}
      {label &&
        (() => {
          const hw = (pl.w - GAP) / 2
          const hl = (pl.l - GAP) / 2
          const fs = Math.min(0.9, 0.4 + Math.min(pl.w, pl.l, pl.h) * 0.12)
          const eps = 0.025
          // stamp on all four sides
          const faces: Array<[[number, number, number], [number, number, number]]> = [
            [[cx, cy, cz + hl + eps], [0, 0, 0]],
            [[cx, cy, cz - hl - eps], [0, Math.PI, 0]],
            [[cx + hw + eps, cy, cz], [0, Math.PI / 2, 0]],
            [[cx - hw - eps, cy, cz], [0, -Math.PI / 2, 0]]
          ]
          return faces.map(([p, r], i) => (
            <Text
              key={i}
              font={sairaFont}
              position={p}
              rotation={r}
              fontSize={fs}
              color="#fff"
              anchorX="center"
              anchorY="middle"
              outlineWidth={fs * 0.08}
              outlineColor="#05080a"
            >
              {label}
            </Text>
          ))
        })()}
    </group>
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
      {/* faint fill for empty bays */}
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

type ObjMeta = Map<string, { contractId: string; destination: string }>

function freezeBox(objMeta: ObjMeta, box: PackBox, p?: Placement): FrozenBox {
  const meta = objMeta.get(box.objectiveId ?? '')
  return {
    id: `${meta?.contractId ?? ''}:${box.objectiveId}:${box.slot}`,
    size: box.size,
    color: box.color,
    dest: box.dest,
    commodity: box.commodity ?? '',
    stopIdx: box.stopIdx,
    contractId: meta?.contractId ?? '',
    objectiveId: box.objectiveId ?? '',
    destination: meta?.destination ?? '',
    delivered: false,
    slot: box.slot,
    ...(p ? { gridId: p.gridId, x: p.x, y: p.y, z: p.z, w: p.w, l: p.l, h: p.h, rotated: p.rotated } : {})
  }
}

export default function CargoGridPage(): React.ReactElement {
  const contracts = useStore((s) => s.contracts)
  const order = useStore((s) => s.order)
  const route = useStore((s) => s.route)
  const activeShip = useStore((s) => s.settings.activeShip)
  const installedModules = useStore((s) => s.settings.installedModules)
  const turnInDestination = useStore((s) => s.turnInDestination)
  const unmarkTurnIn = useStore((s) => s.unmarkTurnIn)
  const gridFacesSyncedAt = useStore((s) => s.gridFacesSyncedAt)

  // clear old frozen layout
  useEffect(() => {
    const st = useStore.getState()
    if (st.layout) st.unlockLayout()
  }, [])

  const installed = installedModules[activeShip]
  const grids = useMemo(
    () => gridsFor(activeShip, installed),
    [activeShip, installed, gridFacesSyncedAt]
  )
  const frame = useMemo(() => shipFrame(activeShip), [activeShip, gridFacesSyncedAt])
  // secure vaults can't haul
  const shownGrids = useMemo(() => grids.filter((g) => !isSecureBay(g)), [grids])

  const liveSteps = useMemo(
    () => (route ? buildLoadingSteps(contracts, route, order) : []),
    [contracts, route, order]
  )

  // number by drop-off, route order
  const { dropNum, dropStops, objColor } = useMemo(() => {
    const num = new Map<string, number>()
    const stops: Array<{ n: number; code: string; name: string; color: string }> = []
    if (route) {
      let n = 0
      for (const step of route.steps) {
        if (!step.dropRefs.length) continue
        for (const r of step.dropRefs) if (!num.has(r.objectiveId)) num.set(r.objectiveId, n)
        const sd = splitDestination(step.label)
        stops.push({ n, code: sd.code, name: sd.name || step.label, color: stopColor(n) })
        n++
      }
    }
    const oc = new Map<string, string>()
    for (const [oid, n] of num) oc.set(oid, stopColor(n))
    return { dropNum: num, dropStops: stops, objColor: oc }
  }, [route])

  // restamp drop-off number + color
  const applyDropSeq = <T extends { objectiveId?: string; stopIdx: number; color: string }>(
    boxes: T[]
  ): T[] => {
    if (!dropNum.size) return boxes
    return boxes.map((b) => {
      const n = b.objectiveId != null ? dropNum.get(b.objectiveId) : undefined
      return n == null ? b : { ...b, stopIdx: n, color: stopColor(n) }
    })
  }
  // in store so nav survives
  const loading = useStore((s) => s.loadingActive)
  const setLoading = useStore((s) => s.setLoadingActive)
  const manual = useStore((s) => s.manualActive)
  const setManual = useStore((s) => s.setManualActive)
  const loadIdx = useStore((s) => s.loadingIdx)
  const setLoadIdx = useStore((s) => s.setLoadingIdx)
  // freeze while walking
  const frozenSteps = useStore((s) => s.loadingSteps)
  const setFrozenSteps = useStore((s) => s.setLoadingSteps)
  const frozenBoxes = useStore((s) => s.loadingBoxes)
  const setFrozenBoxes = useStore((s) => s.setLoadingBoxes)
  useEffect(() => {
    if (loading) {
      setFrozenSteps((prev) => prev ?? liveSteps)
      setFrozenBoxes((prev) => prev ?? applyDropSeq(packBoxes(contracts, order, true) as PackBox[]))
    } else {
      setFrozenSteps(null)
      setFrozenBoxes(null)
    }
  }, [loading, liveSteps])
  const loadSteps = frozenSteps ?? liveSteps

  // soft turn-in amounts, reopenable
  const turnedIn = useMemo(() => {
    const r: Record<string, number> = {}
    for (const c of contracts)
      for (const o of c.objectives) if (o.turnedInScu !== undefined) r[o.id] = o.turnedInScu
    return r
  }, [contracts])
  // portrait stacks, landscape splits
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setPortrait(window.innerHeight > window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // two-way overlay sync, skip mount
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

  const manualLayout = useStore((s) => s.manualLayout)
  const setManualPlacement = useStore((s) => s.setManualPlacement)
  const clearManualPlacement = useStore((s) => s.clearManualPlacement)
  const clearAllManual = useStore((s) => s.clearAllManual)

  // survives the running pk-ids
  const boxKey = (b: { objectiveId?: string; slot?: number }): string => `${b.objectiveId}#${b.slot}`

  const loadingPack = useMemo(() => {
    if (!loadSteps.length) return null
    const source = frozenBoxes ?? applyDropSeq(packBoxes(contracts, order, true) as PackBox[])
    const fullEvents = buildLoadEvents(loadSteps, source)
    // manual: only hand-placed boxes load
    const events = manual
      ? fullEvents.map((ev) => ({ load: ev.load.filter((b) => manualLayout[boxKey(b)]), drop: ev.drop }))
      : fullEvents
    const snaps = packTimeline(grids, events, true, manual ? manualLayout : undefined).map((s) => ({
      placements: s.placements,
      unplaced: s.unplaced,
      count: s.placements.length + s.unplaced.length
    }))
    return { snaps, stepBoxes: fullEvents.map((e) => e.load) }
  }, [loadSteps, grids, contracts, order, frozenBoxes, manualLayout, manual])

  // hand-placed lock, rest auto-packs
  const splitManual = (
    boxes: PackBox[]
  ): { fixed: Placement[]; occupied: Occupied[]; auto: PackBox[] } => {
    const fixed: Placement[] = []
    const occupied: Occupied[] = []
    const auto: PackBox[] = []
    for (const box of boxes) {
      const mp = manualLayout[boxKey(box)]
      const dims = BOX_DIMS[box.size]
      if (mp && dims) {
        const w = mp.rotated ? dims.l : dims.w
        const l = mp.rotated ? dims.w : dims.l
        fixed.push({ box, gridId: mp.gridId, x: mp.x, y: mp.y, z: mp.z, w, l, h: dims.h, rotated: mp.rotated })
        occupied.push({ gridId: mp.gridId, x: mp.x, y: mp.y, z: mp.z, w, l, h: dims.h, stopIdx: box.stopIdx })
      } else auto.push(box)
    }
    return { fixed, occupied, auto }
  }

  const budgetBoxes = (
    all: ReturnType<typeof packBoxes>,
    budgetFor: (id: string) => number
  ): ReturnType<typeof packBoxes> => {
    const used = new Map<string, number>()
    return all.filter((b) => {
      const budget = budgetFor(b.objectiveId)
      if (budget === Infinity) return true
      if (budget <= 0) return false
      const u = used.get(b.objectiveId) ?? 0
      if (u + b.size > budget) return false
      used.set(b.objectiveId, u + b.size)
      return true
    })
  }

  // first-trip scope, not over capacity
  const tripBudget = useMemo(() => (route ? firstTripBudget(route) : null), [route])
  const livePack = useMemo(() => {
    const all = packBoxes(contracts, order)
    return applyDropSeq(tripBudget ? budgetBoxes(all, tripBudget) : all)
  }, [contracts, order, tripBudget, dropNum])

  const objMeta = useMemo(() => {
    const m = new Map<string, { contractId: string; destination: string }>()
    for (const c of contracts) for (const o of c.objectives) m.set(o.id, { contractId: c.id, destination: o.destination })
    return m
  }, [contracts])

  // manual kept, rest auto-filled
  const plan = useMemo<FrozenBox[]>(() => {
    const { fixed, occupied, auto } = splitManual(livePack as PackBox[])
    const { placements } = packInto(grids, occupied, auto, true)
    const pos = new Map(placements.map((p) => [p.box.id, p]))
    const boxes: FrozenBox[] = fixed.map((p) => freezeBox(objMeta, p.box, p))
    for (const b of auto) boxes.push(freezeBox(objMeta, b, pos.get(b.id)))
    return boxes
  }, [livePack, grids, manualLayout, objMeta])
  const result = useMemo(() => {
    const loadable = grids.filter((g) => g.autoLoad !== false)
    const capacity = loadable.reduce((a, g) => a + g.w * g.l * g.h, 0)
    const shape = (placements: Placement[], unplaced: PackBox[]): ReturnType<typeof packCargo> => {
      const proof = provePeel(loadable, placements)
      return {
        placements,
        unplaced,
        grids: [],
        capacity,
        placedScu: placements.reduce((a, p) => a + p.box.size, 0),
        fits: unplaced.length === 0,
        squeezed: false,
        peelOk: proof.peelOk,
        peelDebt: proof.peelDebt
      }
    }
    const fromFrozen = (boxes: FrozenBox[]): ReturnType<typeof packCargo> => {
      const placements: Placement[] = []
      const unplaced: PackBox[] = []
      for (const b of boxes) {
        if (b.gridId != null && b.x != null) {
          placements.push({ box: b as unknown as PackBox, gridId: b.gridId, x: b.x, y: b.y!, z: b.z!, w: b.w!, l: b.l!, h: b.h!, rotated: !!b.rotated })
        } else unplaced.push(b as unknown as PackBox)
      }
      return shape(placements, unplaced)
    }
    // show only what's aboard now
    if (loading && loadingPack) {
      const snaps = loadingPack.snaps
      if (loadIdx >= snaps.length) return shape([], [])
      const at = Math.min(Math.max(0, loadIdx), snaps.length - 1)
      const snap = snaps[at]
      return shape(snap.placements, snap.unplaced)
    }
    return fromFrozen(plan)
  }, [grids, plan, loadingPack, loading, loadIdx])
  const visiblePlacements = result.placements
  const shownScu = useMemo(() => visiblePlacements.reduce((a, p) => a + p.box.size, 0), [visiblePlacements])
  const visibleCount = result.placements.length + result.unplaced.length

  // route order; revisits appear twice
  const deliveryBuckets = useMemo(() => {
    if (dropStops.length) return dropStops.map((s) => ({ idx: s.n, code: s.code, name: s.name, color: s.color }))
    return deriveStops(contracts, order)
      .filter((s) => s.items.some((i) => !i.delivered))
      .map((s) => ({ idx: s.idx, code: s.code, name: s.name, color: s.color }))
  }, [dropStops, contracts, order])

  // bounds over visible grids
  const { origin, span, half } = useMemo(() => {
    if (!shownGrids.length) return { origin: [0, 0, 0] as [number, number, number], span: 10, half: [5, 5, 5] as [number, number, number] }
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (const g of shownGrids) {
      minX = Math.min(minX, g.x || 0); maxX = Math.max(maxX, (g.x || 0) + g.w)
      minY = Math.min(minY, g.y || 0); maxY = Math.max(maxY, (g.y || 0) + g.h)
      minZ = Math.min(minZ, g.z || 0); maxZ = Math.max(maxZ, (g.z || 0) + g.l)
    }
    const o: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
    return {
      origin: o,
      span: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 6),
      half: [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2] as [number, number, number]
    }
  }, [shownGrids])

  const done = loading && loadIdx >= loadSteps.length
  const currentLoad = loading && !done ? loadSteps[loadIdx] : undefined
  const currentObjIds = useMemo(
    () => new Set([...(currentLoad?.loadIds ?? []), ...(currentLoad?.dropIds ?? [])]),
    [currentLoad]
  )
  const boxMode = (objectiveId?: string): BoxMode => {
    if (!loading) return 'normal'
    if (objectiveId && currentObjIds.has(objectiveId)) return 'current'
    // manual keeps colours; loading grays
    return manual ? 'normal' : 'loaded'
  }
  // resume saved step, clamped
  const resumeIdx = (): void => setLoadIdx((i) => Math.min(Math.max(0, i), Math.max(0, loadSteps.length - 1)))
  const startLoading = (): void => {
    resumeIdx()
    setManual(false)
    setLoading(true)
  }
  // flag adds drag + numbers + legend
  const startManual = (): void => {
    resumeIdx()
    setManual(true)
    setLoading(true)
  }
  useEffect(() => {
    if (!loading && manual) setManual(false)
  }, [loading, manual, setManual])

  const gridById = useMemo(() => new Map(grids.map((g) => [g.id, g])), [grids])
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  // orbit camera saved per ship
  const controlsRef = useRef<React.ElementRef<typeof OrbitControls>>(null)
  const initialView = useMemo(
    () => useStore.getState().settings.gridView?.[activeShip] ?? null,
    // snapshot; writes mustn't feed back
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeShip]
  )
  const saveView = (): void => {
    const c = controlsRef.current
    if (!c) return
    const r = (n: number): number => Math.round(n * 100) / 100
    const p = c.object.position
    const t = c.target
    const view: GridView = { pos: [r(p.x), r(p.y), r(p.z)], target: [r(t.x), r(t.y), r(t.z)] }
    const cur = useStore.getState().settings.gridView ?? {}
    const prev = cur[activeShip]
    if (prev && prev.pos.every((v, i) => v === view.pos[i]) && prev.target.every((v, i) => v === view.target[i]))
      return
    void useStore.getState().updateSettings({ gridView: { ...cur, [activeShip]: view } })
  }

  const onHover = (h: Omit<HoverInfo, 'x' | 'y'>, e: ThreeEvent): void => {
    if (drag) return
    const r = wrap.current?.getBoundingClientRect()
    setHover({ ...h, x: e.nativeEvent.clientX - (r?.left ?? 0), y: e.nativeEvent.clientY - (r?.top ?? 0) })
  }

  // gravity drag to lowest support
  type Ghost = { gridId: string; x: number; y: number; z: number; w: number; l: number; h: number; valid: boolean }
  const [drag, setDrag] = useState<{ key: string; box: PackBox } | null>(null)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  // ship-coord cursor; held box follows
  const [dragPos, setDragPos] = useState<{ x: number; z: number } | null>(null)
  const [dragRot, setDragRot] = useState(false)
  const lastPt = useRef<{ x: number; z: number } | null>(null)

  // occupied cells, minus dragged box
  const occCells = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const p of result.placements) {
      if (drag && boxKey(p.box) === drag.key) continue
      let set = m.get(p.gridId)
      if (!set) {
        set = new Set()
        m.set(p.gridId, set)
      }
      for (let dy = 0; dy < p.h; dy++)
        for (let dz = 0; dz < p.l; dz++)
          for (let dx = 0; dx < p.w; dx++) set.add(`${p.x + dx},${p.y + dy},${p.z + dz}`)
    }
    return m
  }, [result, drag])

  const dropY = (occ: Set<string>, g: CargoGrid, lx: number, lz: number, fw: number, fl: number, fh: number): number => {
    for (let y = 0; y + fh <= g.h; y++) {
      let free = true
      for (let dy = 0; dy < fh && free; dy++)
        for (let dz = 0; dz < fl && free; dz++)
          for (let dx = 0; dx < fw && free; dx++) if (occ.has(`${lx + dx},${y + dy},${lz + dz}`)) free = false
      if (!free) continue
      if (y === 0) return y
      let supported = true
      for (let dz = 0; dz < fl && supported; dz++)
        for (let dx = 0; dx < fw && supported; dx++) if (!occ.has(`${lx + dx},${y - 1},${lz + dz}`)) supported = false
      if (supported) return y
    }
    return -1
  }

  const computeGhost = (shipX: number, shipZ: number): Ghost | null => {
    if (!drag) return null
    const dims = BOX_DIMS[drag.box.size]
    if (!dims) return null
    const fw = dragRot ? dims.l : dims.w
    const fl = dragRot ? dims.w : dims.l
    const fh = dims.h
    for (const g of grids) {
      if (g.autoLoad === false) continue
      const gx = g.x || 0
      const gz = g.z || 0
      if (shipX < gx || shipX >= gx + g.w || shipZ < gz || shipZ >= gz + g.l) continue
      const lx = Math.max(0, Math.min(g.w - fw, Math.floor(shipX - gx)))
      const lz = Math.max(0, Math.min(g.l - fl, Math.floor(shipZ - gz)))
      const y = dropY(occCells.get(g.id) ?? new Set(), g, lx, lz, fw, fl, fh)
      return { gridId: g.id, x: lx, y: y < 0 ? 0 : y, z: lz, w: fw, l: fl, h: fh, valid: y >= 0 }
    }
    return null
  }

  const handleDragMove = (shipX: number, shipZ: number): void => {
    lastPt.current = { x: shipX, z: shipZ }
    setDragPos({ x: shipX, z: shipZ })
    setGhost(computeGhost(shipX, shipZ))
  }

  const commitDrag = (): void => {
    setDrag((d) => {
      if (d && ghost && ghost.valid) {
        setManualPlacement(d.key, { gridId: ghost.gridId, x: ghost.x, y: ghost.y, z: ghost.z, rotated: dragRot })
      }
      return null
    })
    setGhost(null)
    setDragPos(null)
    lastPt.current = null
  }

  // floor first, then stack
  const freeSpot = (size: number): { gridId: string; x: number; y: number; z: number } | null => {
    const dims = BOX_DIMS[size]
    if (!dims) return null
    for (const floorOnly of [true, false]) {
      for (const g of grids) {
        if (g.autoLoad === false) continue
        const occ = occCells.get(g.id) ?? new Set<string>()
        for (let z = 0; z + dims.l <= g.l; z++)
          for (let x = 0; x + dims.w <= g.w; x++) {
            const y = dropY(occ, g, x, z, dims.w, dims.l, dims.h)
            if (y >= 0 && (!floorOnly || y === 0)) return { gridId: g.id, x, y, z }
          }
      }
    }
    return null
  }

  // next unplaced box, first spot
  const placeFromPalette = (objectiveId: string, size: number): void => {
    const set = loadingPack?.stepBoxes[loadIdx] ?? []
    const box = set.find((b) => b.objectiveId === objectiveId && b.size === size && !manualLayout[boxKey(b)])
    if (!box) return
    const spot = freeSpot(size)
    if (!spot) return
    setManualPlacement(boxKey(box), { ...spot, rotated: false })
  }

  // unplaced boxes here, by size
  const palette = useMemo(() => {
    if (!manual || !loadingPack) return []
    const set = loadingPack.stepBoxes[loadIdx] ?? []
    const groups = new Map<string, { objectiveId: string; size: number; color: string; stopIdx: number; count: number }>()
    for (const b of set) {
      if (manualLayout[boxKey(b)]) continue
      const k = `${b.objectiveId}|${b.size}`
      const g = groups.get(k)
      if (g) g.count++
      else groups.set(k, { objectiveId: b.objectiveId ?? '', size: b.size, color: b.color, stopIdx: b.stopIdx, count: 1 })
    }
    return [...groups.values()].sort((a, b) => a.stopIdx - b.stopIdx || b.size - a.size)
  }, [manual, loadingPack, loadIdx, manualLayout])

  useEffect(() => {
    if (!drag) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'r' || e.key === 'R') setDragRot((r) => !r)
      else if (e.key === 'Escape') {
        setDrag(null)
        setGhost(null)
        setDragPos(null)
      }
    }
    const onUp = (): void => commitDrag()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, ghost, dragRot])

  // re-snap on rotate in place
  useEffect(() => {
    if (drag && lastPt.current) setGhost(computeGhost(lastPt.current.x, lastPt.current.z))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragRot])

  if (visibleCount === 0 && !loading) {
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
  const shadowExtent = Math.max(half[0], half[1], half[2]) + 4
  const over = result.unplaced.length > 0

  return (
    <div style={{ padding: PAGE_PADDING, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <PageHeader
        title="CARGO GRID"
        subtitle={`${activeShip}${loading ? (manual ? ' · manual loading' : ' · auto-loading') : ' · load planner'}`}
      />

      <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', flexWrap: 'wrap', margin: '2px 0 10px' }}>
        <Stat label={loading ? 'LOADED' : 'TO LOAD'} value={`${fmt(shownScu)} / ${fmt(result.capacity)} SCU`} />
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
        {!over && !result.peelOk && (
          <span
            style={{ fontFamily: F.body, fontSize: 13, color: '#d9a441', textShadow: GLOW }}
            title="A few boxes are boxed in and will need a quick shuffle to pull out in delivery order. Everything still fits."
          >
            ↺ {result.peelDebt.length} to shuffle
          </span>
        )}
      </div>

      {loading && manual && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
          <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.ghost }}>DELIVERY ORDER</span>
          {deliveryBuckets.map((s) => (
            <span
              key={s.idx}
              title={`Drop-off ${s.idx + 1} - put these toward the exit`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: F.body, fontSize: 12, color: C.dim, border: `1px solid ${C.lineSoft}`, borderRadius: 4, padding: '3px 8px' }}
            >
              <span style={{ width: 17, height: 17, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: s.color, color: '#05080a', borderRadius: 3, fontFamily: F.display, fontSize: 11, fontWeight: 700, boxShadow: GLOW }}>
                {s.idx + 1}
              </span>
              {s.code || s.name}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: F.body, fontSize: 12, color: C.ghost }}>
              drag a box · R rotates · double-click resets one
            </span>
            {Object.keys(manualLayout).length > 0 && (
              <Btn
                onClick={() => clearAllManual()}
                title="Send every hand-placed box back to auto-pack"
                style={{ border: `1px solid ${C.lineStrong}`, background: 'transparent', color: C.dim, fontFamily: F.display, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', padding: '4px 9px', cursor: 'pointer' }}
                hoverStyle={{ color: C.text, border: `1px solid ${C.acc}` }}
              >
                RESET ALL
              </Btn>
            )}
          </span>
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
              steps={loadSteps}
              objColors={objColor}
              manual={manual}
              palette={palette}
              onPlace={placeFromPalette}
              aboardScu={shownScu}
              done={done}
              idx={loadIdx}
              total={loadSteps.length}
              turnedIn={turnedIn}
              onTurnIn={(entries) => turnInDestination(entries)}
              onUnmark={(ids) => unmarkTurnIn(ids)}
              onLoaded={() => setLoadIdx((i) => i + 1)}
              onBack={() => setLoadIdx((i) => Math.max(0, i - 1))}
              onExit={() => setLoading(false)}
              onRestart={() => setLoadIdx(0)}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: F.display, fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', color: C.acc, textShadow: GLOW }}>
              {manual ? 'MANUAL LOADING MODE' : 'AUTO-LOADING MODE'}
            </span>
            <Btn
              onClick={() => setLoading(false)}
              title="Back to the loading-mode chooser"
              style={{
                border: `1px solid ${C.lineStrong}`,
                background: 'transparent',
                color: C.dim,
                fontFamily: F.display,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.14em',
                padding: '6px 12px',
                cursor: 'pointer'
              }}
              hoverStyle={{ color: C.text, border: `1px solid ${C.acc}` }}
            >
              EXIT
            </Btn>
          </div>
        )}
        <div
          ref={wrap}
          style={{ position: 'relative', flex: 1, minHeight: portrait ? 200 : 320, border: `1px solid ${C.line}`, borderRadius: 6, overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 40%, #06090b, #000)' }}
        >
        {!loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 3,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
              background: 'radial-gradient(ellipse at 50% 50%, rgba(2,5,8,0.82), rgba(2,5,8,0.52))'
            }}
          >
            <div style={{ pointerEvents: 'auto', width: '100%', maxWidth: 660, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {loadSteps.length > 0 ? (
                <>
                  <div style={{ fontFamily: F.display, fontSize: 12, letterSpacing: '0.24em', color: C.dim, textAlign: 'center' }}>
                    CHOOSE A LOADING MODE
                  </div>
                  <div style={{ display: 'flex', flexDirection: portrait ? 'column' : 'row', gap: 16 }}>
                    <ModeCard
                      title="AUTO-LOADING MODE"
                      desc="We plan your cargo distribution for you based on your chosen route."
                      onClick={startLoading}
                    />
                    <ModeCard
                      title="MANUAL LOADING MODE"
                      desc="You plan out your own cargo distribution by placing each box inside the 3D grid."
                      onClick={startManual}
                    />
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', fontFamily: F.body, fontSize: 14, color: C.dim, background: 'rgba(8,12,16,0.9)', border: `1px solid ${C.lineStrong}`, borderRadius: 8, padding: '18px 22px' }}>
                  No route yet for this cargo. Add or fix it on the Manifest, then come back to load.
                </div>
              )}
            </div>
          </div>
        )}
        <Canvas key={activeShip} shadows camera={{ position: initialView?.pos ?? [camDist, camDist * 0.8, camDist], fov: 45 }}>
          <ambientLight intensity={0.35} />
          <hemisphereLight args={['#b9d2e6', '#0a0f14', 0.5]} />
          <directionalLight
            position={[half[0] + span * 0.45 + 4, span * 1.5 + 6, half[2] * 0.4 + span * 0.4 + 4]}
            intensity={1.35}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-bias={-0.0004}
            shadow-normalBias={0.02}
            shadow-camera-near={0.5}
            shadow-camera-far={span * 6}
            shadow-camera-left={-shadowExtent}
            shadow-camera-right={shadowExtent}
            shadow-camera-top={shadowExtent}
            shadow-camera-bottom={-shadowExtent}
          />
          <directionalLight position={[-half[0] - span * 0.4, span * 0.8, -half[2] - span * 0.4]} intensity={0.4} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -half[1] - 0.02, 0]} receiveShadow>
            <planeGeometry args={[span * 5, span * 5]} />
            <shadowMaterial transparent opacity={0.32} />
          </mesh>
          {shownGrids.map((g) => (
            <GridShell key={g.id} grid={g} origin={origin} />
          ))}
          <OrientationLabels frame={frame} half={half} />
          {loading && visiblePlacements.map((pl) => {
            const g = gridById.get(pl.gridId)
            if (!g) return null
            const mkey = manual ? boxKey(pl.box) : undefined
            // ghost stands in while dragging
            if (drag && mkey === drag.key) return null
            const mode = boxMode(pl.box.objectiveId)
            if (loading && mode === 'future') return null
            return (
              <Box
                key={pl.box.id}
                pl={pl}
                grid={g}
                origin={origin}
                mode={mode}
                label={manual ? String(pl.box.stopIdx + 1) : undefined}
                draggable={manual && !!mkey}
                onStart={() => {
                  if (!mkey) return
                  setHover(null)
                  setDragRot(manualLayout[mkey]?.rotated ?? pl.rotated)
                  setDrag({ key: mkey, box: pl.box })
                  const sx = (g.x || 0) + pl.x + pl.w / 2
                  const sz = (g.z || 0) + pl.z + pl.l / 2
                  setDragPos({ x: sx, z: sz })
                  lastPt.current = { x: sx, z: sz }
                  setGhost(null)
                }}
                onReset={() => mkey && clearManualPlacement(mkey)}
                onDragMove={drag ? handleDragMove : undefined}
                onHover={onHover}
                onLeave={() => setHover(null)}
              />
            )
          })}
          {drag && (
            <mesh
              position={[0, -origin[1], 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              onPointerMove={(e) => {
                e.stopPropagation()
                handleDragMove(e.point.x + origin[0], e.point.z + origin[2])
              }}
            >
              <planeGeometry args={[4000, 4000]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          )}
          {drag &&
            dragPos &&
            (() => {
              const dims = BOX_DIMS[drag.box.size]
              if (!dims) return null
              const w = dragRot ? dims.l : dims.w
              const l = dragRot ? dims.w : dims.l
              const h = dims.h
              // hair above the landing spot
              const gg = ghost ? gridById.get(ghost.gridId) : undefined
              const cy =
                ghost && gg
                  ? center((gg.y || 0) + ghost.y, h, origin[1]) + 0.35
                  : -half[1] + 1.2 + h / 2
              return (
                <mesh
                  raycast={() => null}
                  position={[dragPos.x - origin[0], cy, dragPos.z - origin[2]]}
                >
                  <boxGeometry args={[w - GAP, h - GAP, l - GAP]} />
                  <meshStandardMaterial color={drag.box.color} roughness={0.6} metalness={0} emissive={C.green} emissiveIntensity={0.1} />
                  <Edges color={C.green} />
                </mesh>
              )
            })()}
          {drag &&
            ghost &&
            (() => {
              const g = gridById.get(ghost.gridId)
              if (!g) return null
              const col = ghost.valid ? C.purple : C.red
              return (
                <RoundedBox
                  raycast={() => null}
                  args={[ghost.w - GAP, ghost.h - GAP, ghost.l - GAP]}
                  radius={Math.min(0.09, (Math.min(ghost.w, ghost.h, ghost.l) - GAP) / 2 - 0.02)}
                  smoothness={3}
                  steps={1}
                  position={[
                    center((g.x || 0) + ghost.x, ghost.w, origin[0]),
                    center((g.y || 0) + ghost.y, ghost.h, origin[1]),
                    center((g.z || 0) + ghost.z, ghost.l, origin[2])
                  ]}
                >
                  <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.55} transparent opacity={0.45} depthWrite={false} />
                </RoundedBox>
              )
            })()}
          <OrbitControls ref={controlsRef} makeDefault enablePan enabled={!drag} target={initialView?.target ?? [0, 0, 0]} onEnd={saveView} />
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
    </div>
  )
}

function ModeCard({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }): React.ReactElement {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1,
        minWidth: 0,
        textAlign: 'left',
        cursor: 'pointer',
        background: hover ? C.accFillStrong : 'rgba(8,12,16,0.9)',
        border: `1px solid ${hover ? C.acc : C.lineStrong}`,
        borderRadius: 8,
        padding: '20px 22px',
        boxShadow: hover ? GLOW : 'none',
        transition: 'background 120ms, border-color 120ms'
      }}
    >
      <div style={{ fontFamily: F.display, fontSize: 19, fontWeight: 700, letterSpacing: '0.1em', color: C.text, textShadow: hover ? GLOW : 'none', marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ fontFamily: F.body, fontSize: 15, lineHeight: 1.55, color: C.textBody }}>{desc}</div>
    </button>
  )
}

type TurnInEntry = { contractId: string; objectiveId: string; deliveredScu: number }

type PaletteItem = { objectiveId: string; size: number; color: string; stopIdx: number; count: number }

function LoadingPanel({
  step,
  steps,
  objColors,
  manual,
  palette,
  onPlace,
  aboardScu,
  done,
  idx,
  total,
  turnedIn,
  onTurnIn,
  onUnmark,
  onLoaded,
  onBack,
  onExit,
  onRestart
}: {
  step: LoadingStep | undefined
  steps: LoadingStep[]
  objColors: Map<string, string>
  manual: boolean
  palette: PaletteItem[]
  onPlace: (objectiveId: string, size: number) => void
  aboardScu: number
  done: boolean
  idx: number
  total: number
  turnedIn: Record<string, number>
  onTurnIn: (entries: TurnInEntry[]) => void
  onUnmark: (objectiveIds: string[]) => void
  onLoaded: () => void
  onBack: () => void
  onExit: () => void
  onRestart: () => void
}): React.ReactElement {
  const isDrop = step?.kind === 'drop'
  // split bucket: only last trip
  const isFinalChunk = (l: LoadingStep['lines'][number]): boolean => l.tripPos >= l.tripTotal
  const dropLines = isDrop ? step!.lines.filter(isFinalChunk) : []

  const turnInItems: TurnInItem[] = dropLines.map((l) => ({
    objectiveId: l.objectiveId,
    contractId: l.contractId,
    breakdown: l.totalBreakdown,
    commodity: l.commodity,
    ref: l.ref,
    totalScu: l.totalScu,
    turnedInScu: turnedIn[l.objectiveId]
  }))
  const [modal, setModal] = useState(false)
  const currentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const navBtn = (label: string, onClick: () => void, disabled?: boolean): React.ReactElement => (
    <Btn
      onClick={onClick}
      disabled={disabled}
      style={{ border: `1px solid ${C.lineStrong}`, background: 'transparent', color: disabled ? C.ghost : C.dim, cursor: disabled ? 'default' : 'pointer', fontFamily: F.display, fontSize: 12, letterSpacing: '0.1em', padding: '8px 12px' }}
      hoverStyle={disabled ? {} : { color: C.text, border: `1px solid ${C.acc}` }}
    >
      {label}
    </Btn>
  )

  // big chevrons for low-vision
  const arrowBtn = (label: string, onClick: () => void, disabled?: boolean): React.ReactElement => (
    <Btn
      onClick={onClick}
      disabled={disabled}
      title={label === '‹' ? 'Previous step' : 'Next step'}
      style={{ border: `1px solid ${C.lineStrong}`, background: 'transparent', color: disabled ? C.ghost : C.dim, cursor: disabled ? 'default' : 'pointer', fontFamily: F.display, fontSize: 30, fontWeight: 700, lineHeight: 1, padding: '4px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      hoverStyle={disabled ? {} : { color: C.text, border: `1px solid ${C.acc}` }}
    >
      {label}
    </Btn>
  )

  if (done || !step) {
    return (
      <div style={{ border: `1px solid ${C.green}`, borderRadius: 6, padding: '14px 16px', height: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F.display, fontSize: 14, fontWeight: 600, letterSpacing: '0.1em', color: C.green, textShadow: GLOW }}>
          ✓ ROUTE WALKED · {total} STEPS
        </span>
        <span style={{ fontFamily: F.body, fontSize: 12.5, color: C.dim }}>
          Start over to walk it again, or exit back to the full load plan.
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
          {navBtn('BACK', onBack, idx === 0)}
          {navBtn('START OVER', onRestart)}
          {navBtn('EXIT', onExit)}
        </span>
      </div>
    )
  }

  const isLoad = step.kind === 'load'
  const destLabel = destLabelOf(step.boundFor)
  // this location's contiguous steps
  let visitStart = idx
  while (visitStart > 0 && steps[visitStart - 1]?.nodeKey === step.nodeKey && steps[visitStart - 1]?.trip === step.trip)
    visitStart--
  let visitEnd = idx
  while (steps[visitEnd + 1]?.nodeKey === step.nodeKey && steps[visitEnd + 1]?.trip === step.trip) visitEnd++
  const here = steps.slice(visitStart, visitEnd + 1)

  const anyTurnedIn = dropLines.some((l) => turnedIn[l.objectiveId] !== undefined)

  return (
    <div style={{ position: 'relative', border: `1px solid ${C.acc}`, borderRadius: 6, background: C.accFill, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Btn
        onClick={onExit}
        title="Exit loading mode"
        style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${C.lineStrong}`, background: 'rgba(0,0,0,0.25)', color: C.dim, fontFamily: F.display, fontSize: 18, lineHeight: 1, cursor: 'pointer' }}
        hoverStyle={{ color: C.text, border: `1px solid ${C.acc}` }}
      >
        ✕
      </Btn>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', padding: '14px 44px 10px 16px', flex: 'none' }}>
        <span style={{ fontFamily: F.display, fontSize: 12, letterSpacing: '0.18em', color: C.acc }}>
          STEP {idx + 1} / {total}
        </span>
        <span style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600, color: C.text, textShadow: GLOW }}>
          {step.code && step.code.toLowerCase() !== step.label.toLowerCase() ? `${step.code} · ` : ''}{step.label}
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>{fmt(aboardScu)} SCU aboard</span>
        {!isLoad && (
          <span style={{ marginLeft: 'auto', fontFamily: F.body, fontSize: 12, color: C.ghost }}>
            NEXT just previews · nothing locks until the game finishes the contract
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 16px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {here.map((s, li) => {
          const gi = visitStart + li
          const isCurrent = gi === idx
          const isPast = gi < idx
          const load = s.kind === 'load'
          const accent = (load ? objColors.get(s.lines[0]?.objectiveId) : C.acc) ?? C.green
          return (
            <div
              key={`${s.kind}-${s.boundFor}-${gi}`}
              ref={isCurrent ? currentRef : undefined}
              style={{
                borderLeft: `3px solid ${accent}`,
                border: `1px solid ${isCurrent ? accent : C.lineFaint}`,
                borderLeftWidth: 3,
                borderRadius: 6,
                background: isCurrent ? 'rgba(255,255,255,0.045)' : 'transparent',
                opacity: isPast ? 0.5 : 1,
                padding: '8px 11px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: accent, boxShadow: isCurrent ? GLOW : 'none', flex: 'none' }} />
                <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.14em', color: isCurrent ? C.text : C.dim }}>
                  {load ? `LOAD · bound for ${destLabelOf(s.boundFor)}` : `DELIVER → ${destLabelOf(s.boundFor)}`}
                </span>
                {isCurrent && (
                  <span style={{ marginLeft: 'auto', fontFamily: F.display, fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: C.acc }}>● NOW</span>
                )}
                {isPast && <span style={{ marginLeft: 'auto', fontFamily: F.body, fontSize: 11, color: C.green }}>✓ done</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {s.lines.map((l) =>
                  load ? (
                    <LoadLineRow key={l.objectiveId} line={l} color={objColors.get(l.objectiveId)} />
                  ) : !isFinalChunk(l) ? (
                    <SplitDropRow key={l.objectiveId} line={l} />
                  ) : (
                    <DropLineRow key={l.objectiveId} line={l} turnedInScu={turnedIn[l.objectiveId]} color={objColors.get(l.objectiveId)} />
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>

      {manual && isLoad && (
        <div style={{ flex: 'none', padding: '10px 16px', borderTop: `1px solid ${C.lineFaint}` }}>
          <div style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.14em', color: C.ghost, marginBottom: 8 }}>
            CLICK A BOX TO LOAD IT · THEN DRAG IT IN THE HOLD
          </div>
          {palette.length === 0 ? (
            <div style={{ fontFamily: F.body, fontSize: 13, color: C.green }}>
              ✓ all loaded here, hit NEXT for the next set
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxHeight: 170, overflowY: 'auto', paddingTop: 10, paddingRight: 10 }}>
              {palette.map((p) => (
                <button
                  key={`${p.objectiveId}-${p.size}`}
                  onClick={() => onPlace(p.objectiveId, p.size)}
                  title={`Load a ${p.size} SCU box for drop-off ${p.stopIdx + 1}`}
                  style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '7px 9px 5px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${p.color}`, borderRadius: 6, cursor: 'pointer' }}
                >
                  <IsoCube color={p.color} label={String(p.size)} />
                  <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.text }}>{p.size} SCU</span>
                  <span style={{ position: 'absolute', top: -8, right: -8, minWidth: 19, height: 19, padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: p.color, color: '#05080a', borderRadius: 10, fontFamily: F.display, fontSize: 11, fontWeight: 700, boxShadow: GLOW }}>
                    ×{p.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, padding: '10px 16px 14px', flex: 'none', borderTop: `1px solid ${C.lineFaint}` }}>
        {arrowBtn('‹', onBack, idx === 0)}
        {isLoad ? (
          <Btn
            onClick={onLoaded}
            style={{ flex: 1, border: `1px solid ${C.acc}`, background: C.accFillStrong, color: C.text, textShadow: GLOW, fontFamily: F.display, fontSize: 13, fontWeight: 600, letterSpacing: '0.16em', padding: 11, cursor: 'pointer' }}
            hoverStyle={{ background: 'rgba(255,210,30,0.26)' }}
          >
            LOADED · NEXT
          </Btn>
        ) : (
          <>
            <Btn
              onClick={() => setModal(true)}
              style={{ flex: 1, border: `1px solid ${anyTurnedIn ? C.green : C.acc}`, background: anyTurnedIn ? 'rgba(95,208,137,0.12)' : C.accFillStrong, color: anyTurnedIn ? C.green : C.text, textShadow: GLOW, fontFamily: F.display, fontSize: 13, fontWeight: 600, letterSpacing: '0.14em', padding: 11, cursor: 'pointer' }}
              hoverStyle={{ background: anyTurnedIn ? 'rgba(95,208,137,0.2)' : 'rgba(255,210,30,0.26)' }}
            >
              {anyTurnedIn ? 'TURNED IN · EDIT' : 'TURN IN'}
            </Btn>
            {arrowBtn('›', onLoaded)}
          </>
        )}
      </div>

      {modal && (
        <TurnInModal
          heading={destLabel}
          sub="you can change this until the game finishes the contract"
          items={turnInItems}
          onSave={(entries) => {
            onTurnIn(entries)
            setModal(false)
          }}
          onUnmark={(ids) => {
            onUnmark(ids)
            setModal(false)
          }}
          onSkip={() => {
            setModal(false)
            onLoaded()
          }}
          onClose={() => setModal(false)}
        />
      )}
    </div>
  )
}

function destLabelOf(destination: string): string {
  const d = splitDestination(destination)
  return d.code ? `${d.code} · ${d.name}` : d.name || destination
}

// drops lag a step
function buildLoadEvents(loadSteps: LoadingStep[], source: PackBox[]): LoadEvent[] {
  const pool = new Map<string, PackBox[]>()
  for (const b of source) {
    const arr = pool.get(b.objectiveId!) ?? []
    arr.push(b)
    pool.set(b.objectiveId!, arr)
  }
  for (const arr of pool.values()) arr.sort((a, b) => b.size - a.size)
  const aboard = new Map<string, Set<string>>()
  // exact sizes, match the breakdown
  const take = (objId: string, sizes: number[]): PackBox[] => {
    const have = aboard.get(objId) ?? new Set<string>()
    const avail = pool.get(objId) ?? []
    const got: PackBox[] = []
    for (const sz of [...sizes].sort((a, b) => b - a)) {
      const b = avail.find((x) => x.size === sz && !have.has(x.id))
      if (b) {
        have.add(b.id)
        got.push(b)
      }
    }
    aboard.set(objId, have)
    return got
  }
  const release = (objId: string, scu: number): string[] => {
    const have = aboard.get(objId)
    if (!have) return []
    const gone: string[] = []
    let acc = 0
    for (const b of pool.get(objId) ?? []) {
      if (!have.has(b.id) || acc >= scu) continue
      have.delete(b.id)
      gone.push(b.id)
      acc += b.size
    }
    return gone
  }
  const events: LoadEvent[] = []
  let pendingDrop: string[] = []
  for (const s of loadSteps) {
    const load = s.kind === 'load' ? s.lines.flatMap((l) => take(l.objectiveId, l.loadBoxes)) : []
    events.push({ load, drop: pendingDrop })
    pendingDrop = s.kind === 'drop' ? s.lines.flatMap((l) => release(l.objectiveId, l.scu)) : []
  }
  return events
}


function LoadLineRow({ line, color }: { line: LoadingStep['lines'][number]; color?: string }): React.ReactElement {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.acc }}>{line.ref}</span>
        {line.tell ? (
          <span style={{ fontFamily: F.body, fontSize: 13, color: C.textBody }}>
            find the contract with <b style={{ color: C.text }}>{line.tell}</b>
          </span>
        ) : (
          <span style={{ fontFamily: F.body, fontSize: 13, color: C.amber }}>⚠ no standout box, match the whole set</span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', paddingLeft: 4, alignItems: 'baseline' }}>
        <span style={{ fontFamily: F.mono, fontSize: 13, color: color ?? C.text, fontWeight: 600 }}>{line.breakdown}</span>
        <span style={{ fontFamily: F.body, fontSize: 13, color: C.dim }}>{line.commodity}</span>
        {line.tripTotal > 1 && (
          <span style={{ fontFamily: F.body, fontSize: 11, color: C.amber }}>
            trip {line.tripPos}/{line.tripTotal} · {line.scu} of {line.totalScu} SCU
          </span>
        )}
        {line.multiPickup && (
          <span style={{ fontFamily: F.body, fontSize: 11, color: C.amber }}>(split pickup: load what&apos;s here)</span>
        )}
      </div>
    </div>
  )
}

function turnInSummary(scu: number, total: number): string {
  if (scu >= total) return 'FULL'
  if (scu <= 0) return 'NONE'
  return `${scu} / ${total} SCU`
}

function DropLineRow({
  line,
  turnedInScu,
  color
}: {
  line: LoadingStep['lines'][number]
  turnedInScu?: number
  color?: string
}): React.ReactElement {
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'baseline' }}>
        <span style={{ fontFamily: F.mono, fontSize: 13, color: color ?? C.text, fontWeight: 600 }}>{line.totalBreakdown}</span>
        <span style={{ fontFamily: F.body, fontSize: 13, color: C.dim }}>{line.commodity}</span>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.ghost }}>[{line.ref}]</span>
      </div>
      {line.tripTotal > 1 && (
        <div style={{ fontFamily: F.body, fontSize: 11.5, color: C.amber, marginTop: 2 }}>
          final trip of {line.tripTotal}, turning in completes the full {line.totalScu} SCU
        </div>
      )}
      {turnedInScu !== undefined ? (
        <div style={{ fontFamily: F.body, fontSize: 12.5, color: C.green, marginTop: 3 }}>
          ✓ turned in: {turnInSummary(turnedInScu, line.totalScu)}
        </div>
      ) : (
        <div style={{ fontFamily: F.body, fontSize: 12.5, color: C.ghost, marginTop: 3 }}>not turned in yet</div>
      )}
    </div>
  )
}

// earlier trips, turn in later
function SplitDropRow({ line }: { line: LoadingStep['lines'][number] }): React.ReactElement {
  const rest = Math.max(0, line.totalScu - line.scu)
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'baseline' }}>
        <span style={{ fontFamily: F.mono, fontSize: 13, color: C.text }}>{line.breakdown}</span>
        <span style={{ fontFamily: F.body, fontSize: 13, color: C.dim }}>{line.commodity}</span>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.ghost }}>[{line.ref}]</span>
      </div>
      <div style={{ fontFamily: F.body, fontSize: 11.5, color: C.amber, marginTop: 3 }}>
        drop this trip&apos;s {line.scu} SCU (trip {line.tripPos}/{line.tripTotal}) · {rest} SCU rides a later trip; turn in the full contract then
      </div>
    </div>
  )
}

// isometric crate for the palette
function IsoCube({ color, label }: { color: string; label: string }): React.ReactElement {
  return (
    <svg width={42} height={42} viewBox="0 0 40 40" style={{ display: 'block' }}>
      <path d="M20 3 L37 12.5 L20 22 L3 12.5 Z" fill={color} />
      <path d="M3 12.5 L20 22 L20 38 L3 28.5 Z" fill={color} opacity={0.72} />
      <path d="M37 12.5 L20 22 L20 38 L37 28.5 Z" fill={color} opacity={0.5} />
      <text x={20} y={15.5} textAnchor="middle" fontFamily={F.display} fontSize={8.5} fontWeight={700} fill="#05080a">
        {label}
      </text>
    </svg>
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
