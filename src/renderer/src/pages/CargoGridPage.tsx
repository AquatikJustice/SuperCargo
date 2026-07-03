import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Text, RoundedBox, Edges } from '@react-three/drei'
import sairaFont from '@fontsource/saira/files/saira-latin-600-normal.woff?url'
import jetbrainsFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff?url'
import { useStore } from '../state/store'
import { C, F, GLOW, fmt, stopColor } from '../theme'
import { packBoxes, pickupVisitKey } from '../state/manifest'
import { buildLoadingSteps, buildLoadEvents, filterDeferredSteps, loadProfile, type LoadingStep } from '../state/loading'
import { firstTripBudget } from '../state/route'
import { splitDestination } from '../data/stations'
import { gridsFor, shipFrame, isSecureBay, type CargoGrid } from '@shared/cargoGrids'
import type { BayDir } from '@shared/types'
import { packCargo, packInto, provePeel, type Placement, type PackBox } from '@shared/packer'
import { setAsideToUnload, looseSummary, bucketDecision, type SetAside, type BucketDecision } from '@shared/loadout'
import { listBreakdown } from '@shared/box'
import { planHold } from '@shared/hold'
import { BOX_DIMS } from '@shared/boxGeometry'
import type { FrozenBox, GridView, LoadedPin } from '@shared/types'
import { Btn } from '../components/ui'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import Placeholder from '../components/Placeholder'
import TurnInModal, { type TurnInItem } from '../components/TurnInModal'
import LoadBar from '../components/LoadBar'

const GAP = 0.08

const BOX_GRAY = '#787d82'
const BOX_GRAY_LOADED = '#5b6065'
const STRIPE_T = 0.3
const STRIPE_MARGIN = 0.06
const STRIPE_PROUD = 0.012 // past the face, no z-fight

const locationFont = jetbrainsFont

const LOADING_PANEL_W = 360

// the virtual off-grid pane: a place to stash loose cargo beside the ship. cells,
// not SCU. the packer never sees it; it's display + drop-target only.
const OFF_GRID_ID = 'off-grid'
const OFF_GRID_W = 8
const OFF_GRID_L = 6
const OFF_GRID_H = 4
const OFF_GAP = 3 // clear space between the ship's last bay and the pane

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

// authored off-axis spin (e.g. Hull B's diamond), degrees -> radians for the bay group
function bayRot(grid: CargoGrid): [number, number, number] | undefined {
  const r = grid.rot
  return r ? [(r[0] * Math.PI) / 180, (r[1] * Math.PI) / 180, (r[2] * Math.PI) / 180] : undefined
}

type BoxMode = 'normal' | 'current' | 'loaded' | 'future'

function Box({
  pl,
  origin,
  grid,
  mode,
  label,
  draggable,
  selected,
  offGrid,
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
  selected?: boolean
  offGrid?: boolean
  onStart?: (e: ThreeEvent) => void
  onReset?: () => void
  onDragMove?: (shipX: number, shipZ: number) => void
  onHover: (h: Omit<HoverInfo, 'x' | 'y'>, e: ThreeEvent) => void
  onLeave: () => void
}): React.ReactElement {
  const wx = (grid.x || 0) + pl.x
  const wy = (grid.y || 0) + pl.y
  const wz = (grid.z || 0) + pl.z
  // place boxes relative to the bay center so a rotated bay carries its cargo with it
  const bcx = center(grid.x || 0, grid.w, origin[0])
  const bcy = center(grid.y || 0, grid.h, origin[1])
  const bcz = center(grid.z || 0, grid.l, origin[2])
  const cx = center(wx, pl.w, origin[0]) - bcx
  const cy = center(wy, pl.h, origin[1]) - bcy
  const cz = center(wz, pl.l, origin[2]) - bcz
  const loaded = mode === 'loaded'
  const color = loaded ? BOX_GRAY_LOADED : BOX_GRAY
  const stripeColor = offGrid ? C.amber : loaded ? BOX_GRAY_LOADED : pl.box.color
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
    <group position={[bcx, bcy, bcz]} rotation={bayRot(grid)}>
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
                onStart?.(e)
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
          emissive={selected ? C.acc : offGrid ? C.amber : loaded ? '#000000' : pl.box.color}
          emissiveIntensity={selected ? 0.3 : offGrid ? 0.14 : emissive}
          roughness={0.95}
          metalness={0}
          transparent={opacity < 1}
          opacity={opacity}
        />
        {offGrid && <Edges color={C.amber} />}
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
    <group position={pos} rotation={bayRot(grid)}>
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
  const clearAllPickedUp = useStore((s) => s.clearAllPickedUp)
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
  const { dropNum, objColor } = useMemo(() => {
    const num = new Map<string, number>()
    if (route) {
      let n = 0
      for (const step of route.steps) {
        if (!step.dropRefs.length) continue
        for (const r of step.dropRefs) if (!num.has(r.objectiveId)) num.set(r.objectiveId, n)
        n++
      }
    }
    const oc = new Map<string, string>()
    for (const [oid, n] of num) oc.set(oid, stopColor(n))
    return { dropNum: num, objColor: oc }
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
  const loadIdx = useStore((s) => s.loadingIdx)
  const setLoadIdx = useStore((s) => s.setLoadingIdx)
  const setPickedUp = useStore((s) => s.setPickedUp)
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
  const deferredObjectives = useStore((s) => s.deferredObjectives)
  const tickedObj = useMemo(
    () => new Set(contracts.flatMap((c) => c.objectives.filter((o) => o.pickedUpAt?.length).map((o) => o.id))),
    [contracts]
  )
  // live steps already route deferred cargo to a later trip; the frozen walk prunes it here
  const grabbedObjectives = useStore((s) => s.grabbedObjectives)
  const setObjectiveGrabbed = useStore((s) => s.setObjectiveGrabbed)
  const loadSteps = useMemo(() => {
    if (!frozenSteps) return liveSteps
    return filterDeferredSteps(frozenSteps, new Set(deferredObjectives), (id) => tickedObj.has(id), new Set(grabbedObjectives))
  }, [frozenSteps, liveSteps, deferredObjectives, tickedObj, grabbedObjectives])
  // deferred pickups drop out of the walk, so their undo lives off the step
  const deferredLabels = useMemo(() => {
    const base = frozenSteps ?? liveSteps
    return deferredObjectives
      .filter((id) => !tickedObj.has(id))
      .map((id) => {
        const step = base.find((s) => s.kind === 'load' && s.loadIds.includes(id))
        const line = step?.lines.find((l) => l.objectiveId === id)
        if (!step || !line) return { id, label: id }
        return { id, label: `${line.commodity} · ${line.totalScu} SCU · ${step.code || step.label} → ${destLabelOf(line.destination)}` }
      })
  }, [frozenSteps, liveSteps, deferredObjectives, tickedObj])

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

  const clearLoadedPin = useStore((s) => s.clearLoadedPin)

  // survives the running pk-ids
  const boxKey = (b: { objectiveId?: string; slot?: number }): string => `${b.objectiveId}#${b.slot}`

  const looseBoxes = useStore((s) => s.looseBoxes)
  const setBoxLoose = useStore((s) => s.setBoxLoose)
  const looseSpots = useStore((s) => s.looseSpots)
  const setLooseSpot = useStore((s) => s.setLooseSpot)
  const setObjectiveDeferred = useStore((s) => s.setObjectiveDeferred)
  const loadedPins = useStore((s) => s.loadedPins)
  const addLoadedPins = useStore((s) => s.addLoadedPins)
  const resetWalkDecisions = useStore((s) => s.resetWalkDecisions)
  // every plan feeds the next one: during the walk, boxes that still fit the
  // spot the user saw keep it (planHold prev), so ticks, defers and hand
  // pins re-seat only what they actually displace
  const prevRef = useRef<Map<string, Placement> | null>(null)
  const loadingPack = useMemo(() => {
    if (!loadSteps.length) return null
    const source = frozenBoxes ?? applyDropSeq(packBoxes(contracts, order, true) as PackBox[])
    const events = buildLoadEvents(loadSteps, source)
    const looseIds = new Set(source.filter((b) => looseBoxes.includes(boxKey(b))).map((b) => b.id))
    // cargo already aboard is locked at the spot it was loaded; re-plans pack around it
    const pins = new Map<string, Placement>()
    for (const b of source) {
      const lp = loadedPins[boxKey(b)]
      const dims = BOX_DIMS[b.size]
      if (!lp || !dims) continue
      const w = lp.rotated ? dims.l : dims.w
      const l = lp.rotated ? dims.w : dims.l
      pins.set(b.id, { box: b, gridId: lp.gridId, x: lp.x, y: lp.y, z: lp.z, w, l, h: dims.h, rotated: lp.rotated })
    }
    // apply prev only while a walk is frozen; planning stays a fresh solve.
    // Captured from every plan, so the walk starts from the exact layout the
    // user saw when they pressed start
    const prev = new Map<string, Placement>()
    if (frozenBoxes && prevRef.current)
      for (const b of source) {
        const pl = prevRef.current.get(boxKey(b))
        if (pl) prev.set(b.id, pl)
      }
    const raw = planHold(grids, events, {
      loose: looseIds,
      pins: pins.size ? pins : undefined,
      prev: prev.size ? prev : undefined
    }).snaps
    const m = new Map<string, Placement>()
    for (const s of raw) for (const p of s.placements) if (!m.has(boxKey(p.box))) m.set(boxKey(p.box), p)
    prevRef.current = m
    const snaps = raw.map((s) => ({
      placements: s.placements,
      unplaced: s.unplaced,
      loose: ('loose' in s ? s.loose : []) as PackBox[],
      count: s.placements.length + s.unplaced.length
    }))
    return { snaps, stepBoxes: events.map((e) => e.load) }
  }, [loadSteps, grids, contracts, order, frozenBoxes, looseBoxes, loadedPins])

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

  const plan = useMemo<FrozenBox[]>(() => {
    const boxes = livePack as PackBox[]
    const { placements } = packInto(grids, [], boxes, true)
    const pos = new Map(placements.map((p) => [p.box.id, p]))
    return boxes.map((b) => freezeBox(objMeta, b, pos.get(b.id)))
  }, [livePack, grids, objMeta])
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
  const setAside = useMemo(
    () => setAsideToUnload(grids.filter((g) => g.autoLoad !== false), result.placements),
    [grids, result]
  )
  // off-grid boxes aboard at the current step (they drop off as their stop is delivered)
  const looseNow = useMemo<PackBox[]>(() => {
    if (!(loading && loadingPack) || !loadingPack.snaps.length) return []
    const at = Math.min(Math.max(0, loadIdx), loadingPack.snaps.length - 1)
    return loadingPack.snaps[at].loose
  }, [loading, loadingPack, loadIdx])
  const offGrid = useMemo(() => looseSummary(looseNow), [looseNow])
  // heavy once off-grid cargo is a real slice of the hold, not a box or two
  const offGridHeavy = result.capacity > 0 && offGrid.scu > result.capacity * 0.04
  const visiblePlacements = result.placements
  const shownScu = useMemo(() => visiblePlacements.reduce((a, p) => a + p.box.size, 0), [visiblePlacements])
  const visibleCount = result.placements.length + result.unplaced.length

  // bounds over visible grids, plus the off-grid pane so it stays in frame
  const { origin, span, half, offGrid: offGridBay } = useMemo(() => {
    if (!shownGrids.length) return { origin: [0, 0, 0] as [number, number, number], span: 10, half: [5, 5, 5] as [number, number, number], offGrid: null }
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (const g of shownGrids) {
      minX = Math.min(minX, g.x || 0); maxX = Math.max(maxX, (g.x || 0) + g.w)
      minY = Math.min(minY, g.y || 0); maxY = Math.max(maxY, (g.y || 0) + g.h)
      minZ = Math.min(minZ, g.z || 0); maxZ = Math.max(maxZ, (g.z || 0) + g.l)
    }
    // park the pane past the ship's starboard edge, on the deck, centered on the hold's length
    const off: CargoGrid = {
      id: OFF_GRID_ID, name: 'OFF GRID', source: 'override', autoLoad: false,
      x: maxX + OFF_GAP, y: minY, z: minZ + (maxZ - minZ - OFF_GRID_L) / 2,
      w: OFF_GRID_W, l: OFF_GRID_L, h: OFF_GRID_H, scu: OFF_GRID_W * OFF_GRID_L * OFF_GRID_H
    }
    maxX = Math.max(maxX, off.x + off.w)
    maxY = Math.max(maxY, off.y + off.h)
    minZ = Math.min(minZ, off.z); maxZ = Math.max(maxZ, off.z + off.l)
    const o: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
    return {
      origin: o,
      span: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 6),
      half: [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2] as [number, number, number],
      offGrid: off
    }
  }, [shownGrids])

  // lay the loose boxes out in the pane: parked ones keep their spot, the rest
  // auto-shelve on the deck, front-to-back, so a legacy stash still shows somewhere
  const loosePlacements = useMemo<Placement[]>(() => {
    if (!offGridBay || !looseNow.length) return []
    const occ = new Set<string>()
    const mark = (x: number, y: number, z: number, w: number, l: number, h: number): void => {
      for (let dy = 0; dy < h; dy++) for (let dz = 0; dz < l; dz++) for (let dx = 0; dx < w; dx++) occ.add(`${x + dx},${y + dy},${z + dz}`)
    }
    const fits = (x: number, y: number, z: number, w: number, l: number, h: number): boolean => {
      if (x < 0 || z < 0 || x + w > OFF_GRID_W || z + l > OFF_GRID_L || y + h > OFF_GRID_H) return false
      for (let dy = 0; dy < h; dy++) for (let dz = 0; dz < l; dz++) for (let dx = 0; dx < w; dx++) if (occ.has(`${x + dx},${y + dy},${z + dz}`)) return false
      return true
    }
    const out: Placement[] = []
    const shelf: PackBox[] = []
    // seat parked boxes first so auto-shelf works around them
    for (const b of looseNow) {
      const dims = BOX_DIMS[b.size]
      if (!dims) continue
      const sp = looseSpots[boxKey(b)]
      if (sp && sp.gridId === OFF_GRID_ID) {
        const w = sp.rotated ? dims.l : dims.w
        const l = sp.rotated ? dims.w : dims.l
        if (fits(sp.x, sp.y, sp.z, w, l, dims.h)) {
          mark(sp.x, sp.y, sp.z, w, l, dims.h)
          out.push({ box: b, gridId: OFF_GRID_ID, x: sp.x, y: sp.y, z: sp.z, w, l, h: dims.h, rotated: !!sp.rotated })
          continue
        }
      }
      shelf.push(b)
    }
    for (const b of [...shelf].sort((a, c) => boxKey(a).localeCompare(boxKey(c)))) {
      const dims = BOX_DIMS[b.size]
      if (!dims) continue
      let placed = false
      for (let y = 0; y < OFF_GRID_H && !placed; y++)
        for (let z = 0; z <= OFF_GRID_L - dims.l && !placed; z++)
          for (let x = 0; x <= OFF_GRID_W - dims.w && !placed; x++)
            if (fits(x, y, z, dims.w, dims.l, dims.h)) {
              mark(x, y, z, dims.w, dims.l, dims.h)
              out.push({ box: b, gridId: OFF_GRID_ID, x, y, z, w: dims.w, l: dims.l, h: dims.h, rotated: false })
              placed = true
            }
    }
    return out
  }, [offGridBay, looseNow, looseSpots])

  const done = loading && loadIdx >= loadSteps.length
  const currentLoad = loading && !done ? loadSteps[loadIdx] : undefined
  // this step's boxes are always yours to place: drag one and it pins where
  // you drop it, leave the rest and they load exactly as shown
  const placeIds = useMemo(
    () => (loading && currentLoad?.kind === 'load' ? new Set(currentLoad.loadIds) : null),
    [loading, currentLoad]
  )
  // a later visit of this node that only fetches cargo: when raw space is
  // aboard from here to there, offer to grab it now and skip the return.
  // Only offered while standing at the node's first visit, where the grab
  // will land
  const grabOffer = useMemo(() => {
    if (!loading || !frozenSteps || currentLoad?.kind !== 'load' || !loadingPack) return null
    const node = currentLoad.nodeKey
    let vs = loadIdx
    while (vs > 0 && loadSteps[vs - 1].nodeKey === node) vs--
    for (let p = 0; p < vs; p++) if (loadSteps[p].nodeKey === node) return null
    let ve = loadIdx
    while (ve + 1 < loadSteps.length && loadSteps[ve + 1].nodeKey === node) ve++
    for (let k = ve + 1; k < loadSteps.length; k++) {
      if (loadSteps[k].nodeKey !== node) continue
      let b = k
      while (b + 1 < loadSteps.length && loadSteps[b + 1].nodeKey === node) b++
      const visit = loadSteps.slice(k, b + 1)
      if (visit.some((v) => v.kind !== 'load')) return null
      const ids = visit
        .flatMap((v) => v.loadIds)
        .filter((id) => !tickedObj.has(id) && !deferredObjectives.includes(id) && !grabbedObjectives.includes(id))
      if (!ids.length) return null
      const idSet = new Set(ids)
      const boxes = visit.flatMap((v, vi) => loadingPack.stepBoxes[k + vi] ?? []).filter((bx) => bx.objectiveId && idSet.has(bx.objectiveId))
      const scu = boxes.reduce((sum, bx) => sum + bx.size, 0)
      if (!scu) return null
      for (let i = loadIdx; i < k; i++) {
        const aboard = loadingPack.snaps[i]?.placements.reduce((sum, p) => sum + p.box.size, 0) ?? 0
        if (aboard + scu > result.capacity) return null
      }
      return { ids, scu, count: boxes.length, stepNo: k + 1 }
    }
    return null
  }, [loading, frozenSteps, currentLoad, loadingPack, loadIdx, loadSteps, tickedObj, deferredObjectives, grabbedObjectives, result])
  const currentObjIds = useMemo(
    () => new Set([...(currentLoad?.loadIds ?? []), ...(currentLoad?.dropIds ?? [])]),
    [currentLoad]
  )
  const boxMode = (objectiveId?: string): BoxMode => {
    if (!loading) return 'normal'
    if (objectiveId && currentObjIds.has(objectiveId)) return 'current'
    return 'loaded'
  }
  const startLoading = (): void => {
    // resume saved step, clamped
    setLoadIdx((i) => Math.min(Math.max(0, i), Math.max(0, loadSteps.length - 1)))
    setLoading(true)
  }

  // include the pane so its ghost + placements resolve, but it never joins the packer's grids
  const gridById = useMemo(() => {
    const m = new Map(grids.map((g) => [g.id, g]))
    if (offGridBay) m.set(offGridBay.id, offGridBay)
    return m
  }, [grids, offGridBay])
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
  type GhostSpot = { key: string; x: number; y: number; z: number; w: number; l: number; h: number; rotated: boolean }
  type Ghost = { gridId: string; x: number; y: number; z: number; w: number; l: number; h: number; valid: boolean; members?: GhostSpot[] }
  type GroupMember = { key: string; box: PackBox; dx: number; dz: number; w: number; l: number; h: number; rotated: boolean }
  const [drag, setDrag] = useState<{ key: string; box: PackBox } | null>(null)
  // dragging a selected box carries the whole set, offsets frozen at grab
  const [group, setGroup] = useState<GroupMember[] | null>(null)
  const [sel, setSel] = useState<Set<string>>(() => new Set())
  const [ghost, setGhost] = useState<Ghost | null>(null)
  // where the plan had each dragged box before you grabbed it
  type Origin = { gridId: string; x: number; y: number; z: number; w: number; l: number; h: number }
  const [origins, setOrigins] = useState<Origin[] | null>(null)
  // ship-coord cursor; held box follows
  const [dragPos, setDragPos] = useState<{ x: number; z: number } | null>(null)
  const [dragRot, setDragRot] = useState(false)
  const lastPt = useRef<{ x: number; z: number } | null>(null)

  const dragKeys = useMemo(
    () => (drag ? new Set(group ? group.map((m) => m.key) : [drag.key]) : null),
    [drag, group]
  )

  // occupied cells, minus whatever's in hand
  const occCells = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const p of result.placements) {
      if (dragKeys?.has(boxKey(p.box))) continue
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
  }, [result, dragKeys])

  // pane cells taken by other loose boxes, so a drop or reshuffle doesn't overlap
  const offOcc = useMemo(() => {
    const set = new Set<string>()
    for (const p of loosePlacements) {
      if (dragKeys?.has(boxKey(p.box))) continue
      for (let dy = 0; dy < p.h; dy++)
        for (let dz = 0; dz < p.l; dz++)
          for (let dx = 0; dx < p.w; dx++) set.add(`${p.x + dx},${p.y + dy},${p.z + dz}`)
    }
    return set
  }, [loosePlacements, dragKeys])

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
    const anchor = group?.find((m) => m.key === drag.key)
    const fw = anchor ? anchor.w : dragRot ? dims.l : dims.w
    const fl = anchor ? anchor.l : dragRot ? dims.w : dims.l
    const fh = dims.h
    // the pane is a single-box target: a group stays a ship-side move
    if (offGridBay && !group) {
      const gx = offGridBay.x
      const gz = offGridBay.z
      if (shipX >= gx && shipX < gx + offGridBay.w && shipZ >= gz && shipZ < gz + offGridBay.l) {
        const lx = Math.max(0, Math.min(offGridBay.w - fw, Math.floor(shipX - gx)))
        const lz = Math.max(0, Math.min(offGridBay.l - fl, Math.floor(shipZ - gz)))
        const y = dropY(offOcc, offGridBay, lx, lz, fw, fl, fh)
        return { gridId: OFF_GRID_ID, x: lx, y: y < 0 ? 0 : y, z: lz, w: fw, l: fl, h: fh, valid: y >= 0 }
      }
    }
    for (const g of grids) {
      if (g.autoLoad === false) continue
      const gx = g.x || 0
      const gz = g.z || 0
      if (shipX < gx || shipX >= gx + g.w || shipZ < gz || shipZ >= gz + g.l) continue
      const lx = Math.max(0, Math.min(g.w - fw, Math.floor(shipX - gx)))
      const lz = Math.max(0, Math.min(g.l - fl, Math.floor(shipZ - gz)))
      if (!group) {
        const y = dropY(occCells.get(g.id) ?? new Set(), g, lx, lz, fw, fl, fh)
        return { gridId: g.id, x: lx, y: y < 0 ? 0 : y, z: lz, w: fw, l: fl, h: fh, valid: y >= 0 }
      }
      // rigid group: same cell offsets, each box falls to its own support.
      // Members go bottom-up and count as floor for whatever rides above
      const occ = new Set(occCells.get(g.id))
      const members: GhostSpot[] = []
      let valid = true
      let ay = 0
      for (const m of group) {
        const mx = lx + m.dx
        const mz = lz + m.dz
        const inside = mx >= 0 && mz >= 0 && mx + m.w <= g.w && mz + m.l <= g.l
        const y = inside ? dropY(occ, g, mx, mz, m.w, m.l, m.h) : -1
        if (y < 0) valid = false
        else
          for (let dy = 0; dy < m.h; dy++)
            for (let dz = 0; dz < m.l; dz++)
              for (let dx = 0; dx < m.w; dx++) occ.add(`${mx + dx},${y + dy},${mz + dz}`)
        if (m.key === drag.key) ay = y < 0 ? 0 : y
        members.push({ key: m.key, x: mx, y: y < 0 ? 0 : y, z: mz, w: m.w, l: m.l, h: m.h, rotated: m.rotated })
      }
      return { gridId: g.id, x: lx, y: ay, z: lz, w: fw, l: fl, h: fh, valid, members }
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
        const spots = ghost.members ?? [{ key: d.key, x: ghost.x, y: ghost.y, z: ghost.z, rotated: dragRot }]
        if (ghost.gridId === OFF_GRID_ID) {
          // dropped into the pane: it rides loose here, out of the plan; a
          // stale pin would keep haunting the bay it left
          if (loadedPins[d.key]) clearLoadedPin(d.key)
          setBoxLoose(d.key, true)
          setLooseSpot(d.key, { gridId: OFF_GRID_ID, x: ghost.x, y: ghost.y, z: ghost.z, rotated: dragRot })
        } else if (currentLoad?.kind === 'load') {
          // placing a box pins it there; the re-plan keeps everything the drop
          // didn't displace. a box pulled off the pane rejoins the plan, loaded now
          const pins: Record<string, LoadedPin> = {}
          const pickupKey = pickupVisitKey(currentLoad.nodeKey, currentLoad.trip)
          for (const s of spots) {
            if (looseBoxes.includes(s.key)) setBoxLoose(s.key, false)
            pins[s.key] = { gridId: ghost.gridId, x: s.x, y: s.y, z: s.z, rotated: s.rotated, pickupKey }
          }
          addLoadedPins(pins)
        }
        if (ghost.members) setSel(new Set())
      }
      return null
    })
    setGroup(null)
    setGhost(null)
    setOrigins(null)
    setDragPos(null)
    lastPt.current = null
  }

  const startDrag = (key: string, pl: Placement, g: CargoGrid, e: ThreeEvent): void => {
    const ne = e.nativeEvent
    if (ne.ctrlKey || ne.metaKey || ne.shiftKey) {
      setSel((s) => {
        const n = new Set(s)
        if (!n.delete(key)) n.add(key)
        return n
      })
      return
    }
    setHover(null)
    if (sel.has(key)) {
      // grab the whole selection; sort low boxes first so stacks re-seat bottom-up
      const byKey = new Map(result.placements.map((p) => [boxKey(p.box), p]))
      const picked = [...sel]
        .map((k) => {
          const p = byKey.get(k)
          const pg = p ? gridById.get(p.gridId) : undefined
          return p && pg ? { k, p, pg } : null
        })
        .filter((m): m is { k: string; p: Placement; pg: CargoGrid } => !!m)
        .sort((a, b) => (a.pg.y || 0) + a.p.y - ((b.pg.y || 0) + b.p.y))
      setGroup(
        picked.map(({ k, p, pg }) => ({
          key: k,
          box: p.box,
          dx: Math.round((pg.x || 0) + p.x - (g.x || 0) - pl.x),
          dz: Math.round((pg.z || 0) + p.z - (g.z || 0) - pl.z),
          w: p.w,
          l: p.l,
          h: p.h,
          rotated: p.rotated
        }))
      )
      setDragRot(pl.rotated)
      setOrigins(picked.map(({ p }) => ({ gridId: p.gridId, x: p.x, y: p.y, z: p.z, w: p.w, l: p.l, h: p.h })))
    } else {
      if (sel.size) setSel(new Set())
      setDragRot(loadedPins[key]?.rotated ?? pl.rotated)
      setOrigins([{ gridId: g.id, x: pl.x, y: pl.y, z: pl.z, w: pl.w, l: pl.l, h: pl.h }])
    }
    setDrag({ key, box: pl.box })
    const sx = (g.x || 0) + pl.x + pl.w / 2
    const sz = (g.z || 0) + pl.z + pl.l / 2
    setDragPos({ x: sx, z: sz })
    lastPt.current = { x: sx, z: sz }
    setGhost(null)
  }

  useEffect(() => {
    if (!drag) return
    const onKey = (e: KeyboardEvent): void => {
      // no rotating a group; the offsets don't spin
      if ((e.key === 'r' || e.key === 'R') && !group) setDragRot((r) => !r)
      else if (e.key === 'Escape') {
        setDrag(null)
        setGroup(null)
        setGhost(null)
        setOrigins(null)
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
  }, [drag, ghost, dragRot, group])

  useEffect(() => {
    if (!sel.size) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSel(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel])

  // stale keys would grab boxes that already moved on
  useEffect(() => {
    setSel((s) => (s.size ? new Set<string>() : s))
  }, [loading, loadIdx])

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
        subtitle={`${activeShip}${loading ? ' · loading' : ' · load planner'}`}
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
        {!over && setAside.count > 0 && (
          <span
            style={{ fontFamily: F.body, fontSize: 13, color: '#d9a441', textShadow: GLOW }}
            title="To unload in delivery order you'll set these boxes aside to reach the ones underneath. Everything still fits."
          >
            ↺ set aside {setAside.count} to unload{setAside.big ? ` (${setAside.big} big)` : ''}
          </span>
        )}
        {loading && offGrid.count > 0 && (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: F.body, fontSize: 13, color: C.amber }}
            title="Cargo you chose to carry off-grid, riding loose in the hold rather than in a bay slot."
          >
            <OffGridGlyph />
            <span style={{ fontFamily: F.mono }}>off grid {offGrid.count} {offGrid.count === 1 ? 'box' : 'boxes'} / {fmt(offGrid.scu)} SCU</span>
            {offGridHeavy && <span style={{ fontStyle: 'italic', color: C.amber }}>· watch your total</span>}
          </span>
        )}
      </div>

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
              loose={looseNow}
              setAside={setAside}
              unplaced={result.unplaced}
              onStashOffGrid={(boxes) => boxes.forEach((b) => setBoxLoose(`${b.objectiveId}#${b.slot}`, true))}
              onComeBack={(ids) => {
                // the deferred pickup's steps vanish from the walk; keep the
                // cursor on the same physical step
                const gone = new Set(ids.filter((id) => !tickedObj.has(id)))
                const shift = loadSteps.slice(0, loadIdx).filter((s) => s.lines.every((l) => gone.has(l.objectiveId))).length
                ids.forEach((id) => setObjectiveDeferred(id, true))
                if (shift) setLoadIdx((i) => Math.max(0, i - shift))
              }}
              grab={grabOffer ? { scu: grabOffer.scu, count: grabOffer.count, stepNo: grabOffer.stepNo } : null}
              onGrab={() => grabOffer?.ids.forEach((id) => setObjectiveGrabbed(id, true))}
              grabbedHere={currentLoad?.kind === 'load' ? currentLoad.loadIds.filter((id) => grabbedObjectives.includes(id)) : []}
              onUngrab={(ids) => ids.forEach((id) => setObjectiveGrabbed(id, false))}
              deferred={deferredLabels}
              onUndoDefer={(id) => setObjectiveDeferred(id, false)}
              capacity={result.capacity}
              done={done}
              idx={loadIdx}
              total={loadSteps.length}
              turnedIn={turnedIn}
              onTurnIn={(entries) => turnInDestination(entries)}
              onUnmark={(ids) => unmarkTurnIn(ids)}
              onLoaded={() => {
                // loaded step ticks the manifest pickups and locks each box
                // where the plan put it - you can't restack what's aboard
                if (currentLoad?.kind === 'load') {
                  const key = pickupVisitKey(currentLoad.nodeKey, currentLoad.trip)
                  for (const oid of currentLoad.loadIds) {
                    const cid = objMeta.get(oid)?.contractId
                    if (cid) setPickedUp(cid, oid, key, true)
                  }
                  const snap = loadingPack?.snaps[loadIdx]
                  if (snap) {
                    const ids = new Set(currentLoad.loadIds)
                    const posOf = new Map(snap.placements.map((p) => [p.box.id, p]))
                    const pins: Record<string, LoadedPin> = {}
                    for (const b of loadingPack?.stepBoxes[loadIdx] ?? []) {
                      if (!b.objectiveId || !ids.has(b.objectiveId)) continue
                      const p = posOf.get(b.id)
                      if (p) pins[boxKey(b)] = { gridId: p.gridId, x: p.x, y: p.y, z: p.z, rotated: p.rotated, pickupKey: key }
                    }
                    addLoadedPins(pins)
                  }
                }
                setLoadIdx((i) => i + 1)
              }}
              onBack={() => {
                // stepping back re-opens the step you land on: pickups un-tick,
                // turn-ins un-mark, so rewinding resets the manifest as you go
                const prev = loadSteps[loadIdx - 1]
                if (prev?.kind === 'load')
                  for (const oid of prev.loadIds) {
                    const cid = objMeta.get(oid)?.contractId
                    if (cid) setPickedUp(cid, oid, pickupVisitKey(prev.nodeKey, prev.trip), false)
                    // stash decisions rewind with the step too
                    for (const key of looseBoxes) if (key.startsWith(`${oid}#`)) setBoxLoose(key, false)
                  }
                else if (prev?.kind === 'drop') unmarkTurnIn(prev.lines.map((l) => l.objectiveId))
                // rewinding past a come-back's decision point puts that pickup
                // back in the walk (its decision lived at its own load step)
                if (prev && frozenSteps && deferredObjectives.length) {
                  const pos =
                    frozenSteps.indexOf(prev) >= 0
                      ? frozenSteps.indexOf(prev)
                      : frozenSteps.findIndex(
                          (f) => f.kind === prev.kind && f.nodeKey === prev.nodeKey && f.trip === prev.trip && f.boundFor === prev.boundFor && f.groupPos === prev.groupPos
                        )
                  if (pos >= 0)
                    for (const oid of deferredObjectives) {
                      if (tickedObj.has(oid)) continue
                      const decisionAt = frozenSteps.findIndex((f) => f.kind === 'load' && f.loadIds.includes(oid))
                      if (decisionAt >= pos) setObjectiveDeferred(oid, false)
                    }
                }
                setLoadIdx((i) => Math.max(0, i - 1))
              }}
              onExit={() => setLoading(false)}
              onRestart={() => {
                // starting over untouches every pickup, turn-in, and decision
                clearAllPickedUp()
                unmarkTurnIn(contracts.flatMap((c) => c.objectives.map((o) => o.id)))
                resetWalkDecisions()
                setLoadIdx(0)
              }}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: F.display, fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', color: C.acc, textShadow: GLOW }}>
              LOADING MODE
            </span>
            <Btn
              onClick={() => setLoading(false)}
              title="Back to the load planner"
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
                <ModeCard
                  title="START LOADING"
                  desc="We plan your cargo for you and walk you through it stop by stop. Drag any box in the hold to place it yourself along the way."
                  onClick={startLoading}
                />
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
          {loading && offGridBay && (
            <>
              <GridShell grid={offGridBay} origin={origin} />
              <Text
                font={sairaFont}
                position={[
                  center(offGridBay.x, offGridBay.w, origin[0]),
                  center(offGridBay.y, offGridBay.h, origin[1]) + offGridBay.h / 2 + 1,
                  center(offGridBay.z, offGridBay.l, origin[2])
                ]}
                fontSize={Math.min(2.4, Math.max(1, offGridBay.w * 0.22))}
                color={C.amber}
                anchorX="center"
                anchorY="middle"
                letterSpacing={0.14}
                outlineWidth={0.06}
                outlineColor="#000"
              >
                OFF GRID
              </Text>
              {loosePlacements.map((pl) => {
                const key = boxKey(pl.box)
                if (dragKeys?.has(key)) return null
                return (
                  <Box
                    key={pl.box.id}
                    pl={pl}
                    grid={offGridBay}
                    origin={origin}
                    mode="current"
                    offGrid
                    draggable
                    onStart={(e) => startDrag(key, pl, offGridBay, e)}
                    onReset={() => setBoxLoose(key, false)}
                    onDragMove={drag ? handleDragMove : undefined}
                    onHover={onHover}
                    onLeave={() => setHover(null)}
                  />
                )
              })}
            </>
          )}
          {loading && visiblePlacements.map((pl) => {
            const g = gridById.get(pl.gridId)
            if (!g) return null
            const mkey = placeIds?.has(pl.box.objectiveId ?? '') ? boxKey(pl.box) : undefined
            // ghost stands in while dragging
            if (mkey && dragKeys?.has(mkey)) return null
            const mode = boxMode(pl.box.objectiveId)
            if (loading && mode === 'future') return null
            return (
              <Box
                key={pl.box.id}
                pl={pl}
                grid={g}
                origin={origin}
                mode={mode}
                draggable={!!mkey}
                selected={!!mkey && sel.has(mkey)}
                onStart={(e) => {
                  if (mkey) startDrag(mkey, pl, g, e)
                }}
                onReset={() => {
                  if (mkey) clearLoadedPin(mkey)
                }}
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
              const held: { key: string; box: PackBox; dx: number; dz: number; w: number; l: number; h: number }[] =
                group ?? [{ key: drag.key, box: drag.box, dx: 0, dz: 0, w: dragRot ? dims.l : dims.w, l: dragRot ? dims.w : dims.l, h: dims.h }]
              const gg = ghost ? gridById.get(ghost.gridId) : undefined
              return held.map((m) => {
                const spot = ghost && ghost.members ? ghost.members.find((s) => s.key === m.key) : ghost
                // hair above the landing spot
                const cy =
                  spot && gg
                    ? center((gg.y || 0) + spot.y, m.h, origin[1]) + 0.35
                    : -half[1] + 1.2 + m.h / 2
                return (
                  <mesh
                    key={m.key}
                    raycast={() => null}
                    position={[dragPos.x + m.dx - origin[0], cy, dragPos.z + m.dz - origin[2]]}
                  >
                    <boxGeometry args={[m.w - GAP, m.h - GAP, m.l - GAP]} />
                    <meshStandardMaterial color={m.box.color} roughness={0.6} metalness={0} emissive={C.green} emissiveIntensity={0.1} />
                    <Edges color={C.green} />
                  </mesh>
                )
              })
            })()}
          {drag &&
            origins &&
            (() => {
              const byGrid = new Map<string, Origin[]>()
              for (const o of origins) (byGrid.get(o.gridId) ?? byGrid.set(o.gridId, []).get(o.gridId)!).push(o)
              return [...byGrid].map(([gid, spots]) => {
                const g = gridById.get(gid)
                if (!g) return null
                const bcx = center(g.x || 0, g.w, origin[0])
                const bcy = center(g.y || 0, g.h, origin[1])
                const bcz = center(g.z || 0, g.l, origin[2])
                return (
                  <group key={gid} position={[bcx, bcy, bcz]} rotation={bayRot(g)}>
                    {spots.map((s, i) => (
                      <mesh
                        key={i}
                        raycast={() => null}
                        position={[
                          center((g.x || 0) + s.x, s.w, origin[0]) - bcx,
                          center((g.y || 0) + s.y, s.h, origin[1]) - bcy,
                          center((g.z || 0) + s.z, s.l, origin[2]) - bcz
                        ]}
                      >
                        <boxGeometry args={[s.w - GAP, s.h - GAP, s.l - GAP]} />
                        <meshBasicMaterial transparent opacity={0.04} depthWrite={false} color={C.ghost} />
                        <Edges color={C.ghost} />
                      </mesh>
                    ))}
                  </group>
                )
              })
            })()}
          {drag &&
            ghost &&
            (() => {
              const g = gridById.get(ghost.gridId)
              if (!g) return null
              const col = ghost.valid ? C.purple : C.red
              const bcx = center(g.x || 0, g.w, origin[0])
              const bcy = center(g.y || 0, g.h, origin[1])
              const bcz = center(g.z || 0, g.l, origin[2])
              const spots: { x: number; y: number; z: number; w: number; l: number; h: number }[] = ghost.members ?? [ghost]
              return (
                <group position={[bcx, bcy, bcz]} rotation={bayRot(g)}>
                  {spots.map((s, i) => (
                    <RoundedBox
                      key={i}
                      raycast={() => null}
                      args={[s.w - GAP, s.h - GAP, s.l - GAP]}
                      radius={Math.min(0.09, (Math.min(s.w, s.h, s.l) - GAP) / 2 - 0.02)}
                      smoothness={3}
                      steps={1}
                      position={[
                        center((g.x || 0) + s.x, s.w, origin[0]) - bcx,
                        center((g.y || 0) + s.y, s.h, origin[1]) - bcy,
                        center((g.z || 0) + s.z, s.l, origin[2]) - bcz
                      ]}
                    >
                      <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.55} transparent opacity={0.45} depthWrite={false} />
                    </RoundedBox>
                  ))}
                </group>
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

function LoadingPanel({
  step,
  steps,
  objColors,
  loose,
  setAside,
  unplaced,
  onStashOffGrid,
  onComeBack,
  grab,
  onGrab,
  grabbedHere,
  onUngrab,
  deferred,
  onUndoDefer,
  capacity,
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
  loose: PackBox[]
  setAside: SetAside
  unplaced: PackBox[]
  onStashOffGrid: (boxes: PackBox[]) => void
  onComeBack: (objectiveIds: string[]) => void
  grab: { scu: number; count: number; stepNo: number } | null
  onGrab: () => void
  grabbedHere: string[]
  onUngrab: (ids: string[]) => void
  deferred: { id: string; label: string }[]
  onUndoDefer: (id: string) => void
  capacity: number
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
  const { series, peak } = useMemo(() => loadProfile(steps), [steps])
  const aboard = done || !series.length ? 0 : series[Math.max(0, Math.min(idx, series.length - 1))]
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
        {!isLoad && (
          <span style={{ marginLeft: 'auto', fontFamily: F.body, fontSize: 12, color: C.ghost }}>
            NEXT just previews · nothing locks until the game finishes the contract
          </span>
        )}
      </div>

      <div style={{ padding: '0 16px 10px', flex: 'none' }}>
        <LoadBar current={aboard} peak={peak} capacity={capacity} />
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
              {!load && <GrabOffGrid loose={loose} dropIds={s.dropIds} />}
              {load && isCurrent && (
                <PickupDecision
                  decision={bucketDecision(setAside, unplaced, new Set(s.loadIds))}
                  setAside={setAside}
                  destLabel={destLabelOf(s.boundFor)}
                  loadIds={s.loadIds}
                  onStashOffGrid={onStashOffGrid}
                  onComeBack={onComeBack}
                />
              )}
            </div>
          )
        })}
      </div>

      {isLoad && grab && (
        <div style={{ margin: '0 16px 8px', padding: '10px 12px', border: `1px solid ${C.amber}`, borderRadius: 6, flex: 'none' }}>
          <div style={{ fontFamily: F.display, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.12em', color: C.amber }}>
            ALSO HERE · SKIP THE RETURN
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.body, margin: '4px 0 8px' }}>
            {grab.count} boxes / {grab.scu} SCU planned for a return at step {grab.stepNo}. Grab them now and that
            stop drops off the route. They might not stack pretty — place or stash them however you need, we track
            every box.
          </div>
          <Btn
            onClick={onGrab}
            style={{ width: '100%', border: `1px solid ${C.amber}`, background: 'rgba(255,180,60,0.1)', color: C.text, fontFamily: F.display, fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', padding: 8, cursor: 'pointer' }}
            hoverStyle={{ background: 'rgba(255,180,60,0.22)' }}
          >
            GRAB IT NOW
          </Btn>
        </div>
      )}
      {isLoad && grabbedHere.length > 0 && (
        <div style={{ padding: '0 16px 8px', fontFamily: F.mono, fontSize: 10.5, color: C.dim, flex: 'none' }}>
          grabbed early cargo is in this load ·{' '}
          <span style={{ color: C.amber, cursor: 'pointer' }} onClick={() => onUngrab(grabbedHere)}>
            undo
          </span>
        </div>
      )}
      {deferred.length > 0 && (
        <div style={{ margin: '0 16px 8px', padding: '9px 12px', border: `1px solid ${C.lineFaint}`, borderRadius: 6, flex: 'none' }}>
          <div style={{ fontFamily: F.display, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', color: C.ghost, marginBottom: 7 }}>
            COMING BACK LATER
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {deferred.map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.dim, flex: 1, minWidth: 0 }}>{d.label}</span>
                <span style={{ color: C.amber, cursor: 'pointer', fontFamily: F.mono, fontSize: 10.5 }} onClick={() => onUndoDefer(d.id)}>
                  undo
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {isLoad && (
        <div style={{ padding: '0 16px 8px', fontFamily: F.mono, fontSize: 10.5, color: C.dim, flex: 'none' }}>
          drag any box in the hold to place it yourself · double-click undoes
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

// amber cube = cargo riding off-grid; the manifest badge uses a different (red) glyph
function OffGridGlyph({ size = 14 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={C.amber} strokeWidth="1.7" style={{ flex: 'none' }}>
      <path d="M12 2.5l9 5v9l-9 5-9-5v-9z" />
      <path d="M12 2.5v19M3 7.5l9 5 9-5" />
    </svg>
  )
}

// at a drop, the off-grid boxes bound for THIS stop so nothing rattling around gets left behind
function GrabOffGrid({ loose, dropIds }: { loose: PackBox[]; dropIds: string[] }): React.ReactElement | null {
  const ids = new Set(dropIds)
  const mine = loose.filter((b) => b.objectiveId && ids.has(b.objectiveId))
  if (!mine.length) return null
  const summary = looseSummary(mine)
  return (
    <div style={{ marginTop: 10, padding: '11px 13px', borderLeft: `2px solid ${C.amber}`, background: 'rgba(230,182,94,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <OffGridGlyph size={13} />
        <span style={{ fontFamily: F.display, fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', color: C.amber }}>
          GRAB YOUR OFF-GRID CARGO
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {summary.groups.map((g, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 7, height: 7, background: C.amber, transform: 'rotate(45deg)', flex: 'none' }} />
            <span style={{ width: 96, fontFamily: F.mono, fontSize: 12.5, color: C.body, flex: 'none' }}>
              {g.count}× {g.size} SCU
            </span>
            <span style={{ fontFamily: F.body, fontSize: 13, color: C.body }}>{g.commodity}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 9, paddingTop: 8, borderTop: `1px solid rgba(230,182,94,0.25)`, fontFamily: F.mono, fontSize: 12, color: C.amber }}>
        {summary.groups.length} {summary.groups.length === 1 ? 'bucket' : 'buckets'} · {summary.count}{' '}
        {summary.count === 1 ? 'box' : 'boxes'} / {fmt(summary.scu)} SCU off-grid for this stop
      </div>
    </div>
  )
}

// the pickup decision card: when a bucket buries earlier cargo (dig-out) or won't fit
// (overload), surface the honest cost + the choices. Quiet (renders nothing) otherwise.
function PickupDecision({
  decision,
  setAside,
  destLabel,
  loadIds,
  onStashOffGrid,
  onComeBack
}: {
  decision: BucketDecision
  setAside: SetAside
  destLabel: string
  loadIds: string[]
  onStashOffGrid: (boxes: PackBox[]) => void
  onComeBack: (objectiveIds: string[]) => void
}): React.ReactElement | null {
  const [choice, setChoice] = useState<string | null>(null)
  if (decision.kind === 'none') return null

  const dig = decision.kind === 'digout'
  const offScu = decision.overloadBoxes.reduce((a, b) => a + b.size, 0)
  const offBreakdown = listBreakdown(decision.overloadBoxes.map((b) => b.size))
  const bigNote = setAside.big ? `${setAside.big} big · ` : ''

  const pick = (id: string, run: () => void): void => {
    setChoice(id)
    run()
  }

  const options = dig
    ? [
        { id: 'load', title: 'Load it now', desc: `Tightest trip. Set aside ${setAside.count} boxes to dig out earlier stops.`, run: () => {} },
        { id: 'come', title: 'Come back for it', desc: 'Skip the whole pickup for now, grab it on a later pass. No digging.', run: () => onComeBack(loadIds) }
      ]
    : [
        { id: 'stash', title: 'Stash the overflow off-grid', desc: `The rest loads normally; ${offBreakdown} rides in empty corners of the hold.`, run: () => onStashOffGrid(decision.overloadBoxes) },
        { id: 'come', title: `Come back for ${destLabel}'s load`, desc: 'Nothing from this pickup loads now. Its room frees up for later stops and you grab the whole thing on a later trip.', run: () => onComeBack(loadIds) }
      ]

  const confirmCopy: Record<string, string> = {
    load: `Loading now. ${setAside.count} boxes will be set aside to dig out earlier stops.`,
    come: dig ? 'Skipped for now. Grab it on a later pass, no digging.' : 'Whole pickup left for a later trip. Its room is free for later stops.',
    stash: `Stashed off-grid. ${offBreakdown} / ${fmt(offScu)} SCU riding loose from this stop.`
  }

  return (
    <div style={{ marginTop: 10, border: `1px solid ${dig ? '#a99cd0' : '#c9b07e'}`, borderLeftWidth: 3, borderRadius: 6, background: 'rgba(255,255,255,0.02)', padding: '11px 13px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: F.display, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: C.amber }}>
          {dig ? 'DIG-OUT' : "WON'T FIT"}
        </span>
        <span style={{ fontFamily: F.body, fontSize: 11.5, color: C.ghost }}>· bound for {destLabel}</span>
      </div>

      <div style={{ fontFamily: F.body, fontSize: 12.5, lineHeight: 1.5, color: '#b7c0c3', marginBottom: 10 }}>
        {dig
          ? "Loading this now sits it on top of cargo you deliver sooner. To reach that cargo you'll set some boxes aside by hand."
          : 'This won’t all fit the grid. Wedge the overflow into empty corners of the hold, or leave the whole pickup for a later trip.'}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', borderLeft: `2px solid ${C.amber}`, background: 'rgba(230,182,94,0.08)', marginBottom: 12 }}>
        {dig ? <span style={{ color: C.amber, fontSize: 16, lineHeight: 1 }}>↺</span> : <OffGridGlyph />}
        <div>
          <div style={{ fontFamily: F.display, fontSize: 15, fontWeight: 600, letterSpacing: '0.02em', color: C.text }}>
            {dig ? `SET ASIDE ${setAside.count} BOXES` : `${offBreakdown} · ${fmt(offScu)} SCU WON'T FIT`}
          </div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: '#a8b0b3', marginTop: 2 }}>
            {dig ? `${bigNote}${fmt(setAside.scu)} SCU moved by hand` : 'Small boxes wedge into corners safely. Big ones have nowhere to hide.'}
          </div>
        </div>
      </div>

      <div style={{ fontFamily: F.display, fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', color: C.ghost, marginBottom: 8 }}>
        CHOOSE ONE
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((o) => (
          <DecisionOption key={o.id} title={o.title} desc={o.desc} selected={choice === o.id} onClick={() => pick(o.id, o.run)} />
        ))}
      </div>

      {choice && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, paddingTop: 10, borderTop: `1px solid ${C.lineFaint}` }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.4" style={{ flex: 'none' }}>
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <span style={{ fontFamily: F.body, fontSize: 12.5, color: '#c7d0d3' }}>{confirmCopy[choice]}</span>
        </div>
      )}
    </div>
  )
}

function DecisionOption({ title, desc, selected, onClick }: { title: string; desc: string; selected: boolean; onClick: () => void }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 11,
        textAlign: 'left',
        border: `1px solid ${selected ? 'rgba(255,210,30,0.45)' : 'rgba(255,255,255,0.14)'}`,
        background: selected ? 'rgba(255,210,30,0.10)' : 'transparent',
        padding: '9px 12px',
        cursor: 'pointer',
        width: '100%'
      }}
      hoverStyle={selected ? {} : { border: `1px solid rgba(255,255,255,0.34)`, background: 'rgba(255,255,255,0.02)' }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: F.display, fontSize: 14, fontWeight: 600, letterSpacing: '0.02em', color: selected ? C.acc : C.text, textShadow: selected ? GLOW : 'none' }}>
          {title}
        </span>
        <span style={{ display: 'block', fontFamily: F.body, fontSize: 12, color: selected ? '#a8b0b3' : '#98a0a3', marginTop: 2 }}>
          {desc}
        </span>
      </span>
      <span style={{ flex: 'none', width: 16, height: 16, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', background: selected ? C.acc : 'transparent', border: selected ? 'none' : `1.5px solid rgba(255,255,255,0.3)` }}>
        {selected && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
      </span>
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
