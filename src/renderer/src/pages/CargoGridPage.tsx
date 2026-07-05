import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Text, RoundedBox, Edges } from '@react-three/drei'
import sairaFont from '@fontsource/saira/files/saira-latin-600-normal.woff?url'
import jetbrainsFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff?url'
import { useStore } from '../state/store'
import { C, F, GLOW, fmt, stopColor } from '../theme'
import { packBoxes, pickupVisitKey, objectiveStops } from '../state/manifest'
import { buildLoadingSteps, buildLoadEvents, filterDeferredSteps, loadProfile, type LoadingStep } from '../state/loading'
import { firstTripBudget, computeRoutePlan } from '../state/route'
import { splitDestination } from '../data/stations'
import { gridsFor, shipFrame, isSecureBay, offGridFor, gridCapacity, loadableGrids, type CargoGrid } from '@shared/cargoGrids'
import type { BayDir } from '@shared/types'
import { packCargo, provePeel, type Placement, type PackBox } from '@shared/packer'
import { setAsideToUnload, looseSummary, bucketDecision, type SetAside, type BucketDecision } from '@shared/loadout'
import { listBreakdown } from '@shared/box'
import { fixtureMap, planHold } from '@shared/hold'
import { packRun } from '@shared/walkPack'
import { BOX_DIMS } from '@shared/boxGeometry'
import type { FrozenBox, GridView, LoadedPin, StorAllCrate } from '@shared/types'
import { Btn } from '../components/ui'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import Placeholder from '../components/Placeholder'
import TurnInModal, { type TurnInItem } from '../components/TurnInModal'
import LoadBar from '../components/LoadBar'

const GAP = 0.08

const BOX_GRAY = '#787d82'
const BOX_GRAY_LOADED = '#5b6065'
const STOR_BODY = '#191b1f'
const STOR_ORANGE = '#e07f28'
const STOR_STEEL = '#8f959b'
const STRIPE_T = 0.3
const STRIPE_MARGIN = 0.06
const STRIPE_PROUD = 0.012 // past the face, no z-fight

const locationFont = jetbrainsFont

const LOADING_PANEL_W = 360

// the virtual off-grid pane: a place to stash loose cargo beside the ship. cells,
// not SCU. the packer never sees it; it's display + drop-target only.
const OFF_GRID_ID = 'off-grid'
const OFF_GAP = 8 // clear space between the ship's last bay and the pane; the
// STARBOARD floor label lives in this gap, so keep it generous

const STBD_OF: Record<BayDir, BayDir> = { 'z-': 'x+', 'z+': 'x-', 'x+': 'z+', 'x-': 'z-', 'y+': 'x+', 'y-': 'x+' }
const OPP: Record<BayDir, BayDir> = { 'x+': 'x-', 'x-': 'x+', 'y+': 'y-', 'y-': 'y+', 'z+': 'z-', 'z-': 'z+' }

function OrientationLabels({
  frame,
  half,
  shipCenter = [0, 0, 0]
}: {
  frame?: { fore: BayDir; starboard: BayDir }
  half: [number, number, number]
  shipCenter?: [number, number, number]
}): React.ReactElement {
  const fore = frame?.fore ?? 'z-'
  const starboard = frame?.starboard ?? STBD_OF[fore]
  const [hx, hy, hz] = half
  const [sx, sy, sz] = shipCenter
  const size = Math.min(4, Math.max(1.2, Math.max(hx, hz) * 0.12))
  const off = size * 1.1 + 0.6
  const floorY = sy - hy
  const pos = (d: BayDir): [number, number, number] => {
    switch (d) {
      case 'x+': return [sx + hx + off, floorY, sz]
      case 'x-': return [sx - hx - off, floorY, sz]
      case 'z+': return [sx, floorY, sz + hz + off]
      case 'z-': return [sx, floorY, sz - hz - off]
      default: return [sx, floorY, sz]
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

type Ax = 0 | 1 | 2
const axOf = (c: string): Ax => (c === 'x' ? 0 : c === 'y' ? 1 : 2)
const sizeOf = (g: CargoGrid): [number, number, number] => [g.w, g.h, g.l]

interface Cell {
  key: string
  gridId: string
  x: number
  y: number
  z: number
  w: number
  l: number
  h: number
}

// which boxes are held up by the floor or, transitively, by a box that is.
// Runs in each bay's own frame (floor axis + face), so a tilted or roof-floored
// bay resolves the same as a plain y-down one. Anything NOT in this set lost its
// footing (its supporter was dragged away) and should be left to settle.
function groundedSet(cells: Cell[], gridById: Map<string, CargoGrid>, pre?: ReadonlySet<string>): Set<string> {
  const pos = (c: Cell, a: Ax): number => (a === 0 ? c.x : a === 1 ? c.y : c.z)
  const ext = (c: Cell, a: Ax): number => (a === 0 ? c.w : a === 1 ? c.h : c.l)
  const grounded = new Set<string>(pre)
  const byGrid = new Map<string, Cell[]>()
  for (const c of cells) (byGrid.get(c.gridId) ?? byGrid.set(c.gridId, []).get(c.gridId)!).push(c)
  for (const [gid, group] of byGrid) {
    const g = gridById.get(gid)
    if (!g) {
      for (const c of group) grounded.add(c.key)
      continue
    }
    const floor = g.floor ?? 'y-'
    const up = axOf(floor[0])
    const flip = floor[1] === '+'
    const span = sizeOf(g)[up]
    const cross = ([0, 1, 2] as Ax[]).filter((a) => a !== up)
    const spans = (a: Cell, b: Cell): boolean =>
      cross.every((ca) => pos(a, ca) < pos(b, ca) + ext(b, ca) && pos(b, ca) < pos(a, ca) + ext(a, ca))
    const onFloor = (c: Cell): boolean => (flip ? pos(c, up) + ext(c, up) >= span : pos(c, up) <= 0)
    const rests = (b: Cell, s: Cell): boolean =>
      spans(b, s) && (flip ? pos(b, up) + ext(b, up) === pos(s, up) : pos(b, up) === pos(s, up) + ext(s, up))
    for (const c of group) if (onFloor(c)) grounded.add(c.key)
    let changed = true
    while (changed) {
      changed = false
      for (const c of group)
        if (!grounded.has(c.key) && group.some((s) => grounded.has(s.key) && rests(c, s))) {
          grounded.add(c.key)
          changed = true
        }
    }
  }
  return grounded
}

// world-extent per axis for a hand-held box in this bay: h grows off the
// floor face, l runs the exit axis, w takes the axis that's left
function extentsFor(g: CargoGrid, dims: { w: number; l: number; h: number }, rotated: boolean): [number, number, number] {
  const floor = g.floor ?? 'y-'
  const up = axOf(floor[0])
  const depth = g.exit && axOf(g.exit.axis) !== up ? axOf(g.exit.axis) : up === 2 ? 0 : 2
  const cross = (3 - up - depth) as Ax
  // a swap on a sky-pointing cross axis stands the box on end
  const rot = rotated && cross !== 1
  const ext: [number, number, number] = [0, 0, 0]
  ext[up] = dims.h
  ext[depth] = rot ? dims.w : dims.l
  ext[cross] = rot ? dims.l : dims.w
  return ext
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
  blocked,
  onStart,
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
  blocked?: boolean
  onStart?: (e: ThreeEvent) => void
  onDragMove?: (shipX: number, shipZ: number, ray?: THREE.Ray) => void
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
  const stripeColor = selected ? C.acc : offGrid ? C.amber : loaded ? BOX_GRAY_LOADED : pl.box.color
  const opacity = mode === 'future' ? 0.12 : loaded ? 0.82 : 1
  const W = pl.w - GAP
  const H = pl.h - GAP
  const L = pl.l - GAP
  // separates adjacent boxes
  const bevel = Math.min(0.09, Math.min(W, H, L) / 2 - 0.02)
  // the band hugs the face away from the bay's floor, whatever axis that is
  const floorFace = grid.floor ?? 'y-'
  const upAx = axOf(floorFace[0])
  const grow = floorFace[1] === '-' ? 1 : -1
  const exts: [number, number, number] = [W, H, L]
  const bandArgs = exts.map((e, a) => (a === upAx ? STRIPE_T : e + STRIPE_PROUD * 2)) as [number, number, number]
  const bandOff = grow * (exts[upAx] / 2 - STRIPE_MARGIN - STRIPE_T / 2)
  const bandPos: [number, number, number] = [
    cx + (upAx === 0 ? bandOff : 0),
    cy + (upAx === 1 ? bandOff : 0),
    cz + (upAx === 2 ? bandOff : 0)
  ]
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
                onDragMove(e.point.x + origin[0], e.point.z + origin[2], e.ray)
              }
            : undefined
        }
        onPointerDown={
          draggable
            ? (e) => {
                if (e.nativeEvent.button !== 0) return
                e.stopPropagation()
                onStart?.(e)
              }
            : undefined
        }
      >
        <meshStandardMaterial
          color={color}
          roughness={0.95}
          metalness={0}
          emissive={blocked ? '#e02a2a' : '#000000'}
          emissiveIntensity={blocked ? 0.5 : 0}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </RoundedBox>
      <RoundedBox
        args={bandArgs}
        radius={Math.min(0.08, STRIPE_T * 0.45, bevel)}
        smoothness={2}
        steps={1}
        position={bandPos}
        receiveShadow
        raycast={() => null}
      >
        <meshStandardMaterial
          color={stripeColor}
          roughness={0.85}
          metalness={0}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </RoundedBox>
      {!label &&
        mode !== 'future' &&
        (() => {
          const sd = splitDestination(pl.box.dest)
          const loc = sd.code || sd.name
          if (!loc) return null
          // text lives on the four faces parallel to the bay's up axis and
          // reads with its top toward the band, whatever axis that is
          const availH = exts[upAx] - STRIPE_MARGIN - STRIPE_T
          // u already carries the grow sign; putting it here too cancels it
          // and slides the text INTO the band on plus-face floors
          const lowU = -(STRIPE_MARGIN + STRIPE_T) / 2
          const eps = 0.015
          const u = new THREE.Vector3(upAx === 0 ? grow : 0, upAx === 1 ? grow : 0, upAx === 2 ? grow : 0)
          const fit = (fw: number): number =>
            Math.min(0.34, availH * 0.8, (fw * 0.92) / Math.max(3, loc.length * 0.62))
          const c = new THREE.Vector3(cx, cy, cz)
          return ([0, 1, 2].filter((a) => a !== upAx) as Ax[]).flatMap((na) =>
            [1, -1].map((sign) => {
              const n = new THREE.Vector3(na === 0 ? sign : 0, na === 1 ? sign : 0, na === 2 ? sign : 0)
              const right = new THREE.Vector3().crossVectors(u, n)
              const rot = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, u, n))
              const rightAx = right.x !== 0 ? 0 : right.y !== 0 ? 1 : 2
              const fs = fit(exts[rightAx])
              const p = c.clone().addScaledVector(n, exts[na] / 2 + eps).addScaledVector(u, lowU)
              return (
                <Text
                  key={`loc-${na}-${sign}`}
                  font={locationFont}
                  position={[p.x, p.y, p.z]}
                  rotation={[rot.x, rot.y, rot.z]}
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
          )
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

function StorAllBox({
  crate,
  grid,
  origin,
  onStart,
  onRemove,
  onDragMove,
  onHover,
  onLeave
}: {
  crate: StorAllCrate
  grid: CargoGrid
  origin: [number, number, number]
  onStart?: (e: ThreeEvent) => void
  onRemove?: () => void
  onDragMove?: (shipX: number, shipZ: number, ray?: THREE.Ray) => void
  onHover: (h: Omit<HoverInfo, 'x' | 'y'>, e: ThreeEvent) => void
  onLeave: () => void
}): React.ReactElement {
  const bcx = center(grid.x || 0, grid.w, origin[0])
  const bcy = center(grid.y || 0, grid.h, origin[1])
  const bcz = center(grid.z || 0, grid.l, origin[2])
  const cx = center((grid.x || 0) + crate.x, crate.w, origin[0]) - bcx
  const cy = center((grid.y || 0) + crate.y, crate.h, origin[1]) - bcy
  const cz = center((grid.z || 0) + crate.z, crate.l, origin[2]) - bcz
  const W = crate.w - GAP
  const H = crate.h - GAP
  const L = crate.l - GAP
  const exts: [number, number, number] = [W, H, L]
  const bevel = Math.min(0.09, Math.min(W, H, L) / 2 - 0.02)
  const floorFace = grid.floor ?? 'y-'
  const upAx = axOf(floorFace[0])
  const grow = floorFace[1] === '-' ? 1 : -1
  const others = [0, 1, 2].filter((a) => a !== upAx) as [Ax, Ax]
  const c = new THREE.Vector3(cx, cy, cz)
  const u = new THREE.Vector3(upAx === 0 ? grow : 0, upAx === 1 ? grow : 0, upAx === 2 ? grow : 0)
  const rail = 0.1
  const eps = 0.02
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
          onHover({ commodity: 'Stor-All', size: crate.size, dest: 'Personal storage', color: STOR_ORANGE }, e)
        }}
        onPointerOut={() => onLeave()}
        onPointerMove={
          onDragMove
            ? (e) => {
                e.stopPropagation()
                onDragMove(e.point.x + origin[0], e.point.z + origin[2], e.ray)
              }
            : undefined
        }
        onPointerDown={(e) => {
          e.stopPropagation()
          if (e.nativeEvent.button === 2) {
            onRemove?.()
            return
          }
          if (e.nativeEvent.button !== 0) return
          onStart?.(e)
        }}
      >
        <meshStandardMaterial color={STOR_BODY} roughness={0.88} metalness={0.05} />
      </RoundedBox>
      {/* silver cage rails on the edges running floor to lid */}
      {([-1, 1] as const).flatMap((sa) =>
        ([-1, 1] as const).map((sb) => {
          const args: [number, number, number] = [rail, rail, rail]
          args[upAx] = exts[upAx] + 0.05
          const off = [0, 0, 0]
          off[others[0]] = sa * (exts[others[0]] / 2)
          off[others[1]] = sb * (exts[others[1]] / 2)
          return (
            <mesh key={`r${sa}${sb}`} position={[cx + off[0], cy + off[1], cz + off[2]]} raycast={() => null} castShadow>
              <boxGeometry args={args} />
              <meshStandardMaterial color={STOR_STEEL} roughness={0.45} metalness={0.45} />
            </mesh>
          )
        })
      )}
      {/* orange latch caps on the lid */}
      {([-1, 1] as const).map((s) => {
        const off = [0, 0, 0]
        off[upAx] = grow * (exts[upAx] / 2)
        off[others[0]] = s * (exts[others[0]] / 4)
        const args: [number, number, number] = [0, 0, 0]
        args[upAx] = 0.12
        args[others[0]] = Math.min(0.5, exts[others[0]] * 0.3)
        args[others[1]] = Math.min(0.34, exts[others[1]] * 0.3)
        return (
          <mesh key={`l${s}`} position={[cx + off[0], cy + off[1], cz + off[2]]} raycast={() => null}>
            <boxGeometry args={args} />
            <meshStandardMaterial color={STOR_ORANGE} roughness={0.7} metalness={0.1} />
          </mesh>
        )
      })}
      {/* orange X and name on the four side faces */}
      {others.flatMap((na) =>
        ([1, -1] as const).map((sign) => {
          const n = new THREE.Vector3(na === 0 ? sign : 0, na === 1 ? sign : 0, na === 2 ? sign : 0)
          const right = new THREE.Vector3().crossVectors(u, n)
          const rot = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, u, n))
          const rightAx = right.x !== 0 ? 0 : right.y !== 0 ? 1 : 2
          const fw = exts[rightAx as Ax]
          const fh = exts[upAx]
          const p = c.clone().addScaledVector(n, exts[na] / 2 + eps)
          const arm = Math.min(fw, fh) * 0.52
          const fs = Math.min(0.22, (fw * 0.9) / 5.6)
          return (
            <group key={`x${na}${sign}`} position={[p.x, p.y, p.z]} rotation={[rot.x, rot.y, rot.z]}>
              {([1, -1] as const).map((d) => (
                <mesh key={d} rotation={[0, 0, (d * Math.PI) / 4]} position={[0, -fh * 0.06, 0]} raycast={() => null}>
                  <boxGeometry args={[arm, arm * 0.3, 0.025]} />
                  <meshStandardMaterial color={STOR_ORANGE} roughness={0.75} metalness={0} />
                </mesh>
              ))}
              <Text
                font={sairaFont}
                position={[0, fh * 0.34, 0.015]}
                fontSize={fs}
                color={STOR_ORANGE}
                anchorX="center"
                anchorY="middle"
                letterSpacing={0.08}
              >
                STOR-ALL
              </Text>
            </group>
          )
        })
      )}
    </group>
  )
}

function GridShell({
  grid,
  origin,
  color
}: {
  grid: CargoGrid
  origin: [number, number, number]
  color?: string
}): React.ReactElement {
  const refOnly = grid.autoLoad === false
  const geo = useMemo(() => new THREE.BoxGeometry(grid.w, grid.h, grid.l), [grid.w, grid.h, grid.l])
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo])
  const pos: [number, number, number] = [
    center(grid.x || 0, grid.w, origin[0]),
    center(grid.y || 0, grid.h, origin[1]),
    center(grid.z || 0, grid.l, origin[2])
  ]
  const line = color ?? (refOnly ? C.amber : C.acc)
  return (
    <group position={pos} rotation={bayRot(grid)}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={line} transparent opacity={refOnly ? 0.5 : 0.32} />
      </lineSegments>
      {/* faint fill for empty bays */}
      <mesh geometry={geo}>
        <meshBasicMaterial
          color={line}
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
  const locations = useStore((s) => s.locations)
  const startLocation = useStore((s) => s.startLocation)
  const activeShip = useStore((s) => s.settings.activeShip)
  const installedModules = useStore((s) => s.settings.installedModules)
  const spaceDeliveryPiles = useStore((s) => s.settings.spaceDeliveryPiles)
  const updateSettings = useStore((s) => s.updateSettings)
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
  // off-grid stash pad size, or null when the ship has it turned off
  const offPad = useMemo(() => offGridFor(activeShip), [activeShip, gridFacesSyncedAt])
  // secure vaults can't haul
  const shownGrids = useMemo(() => grids.filter((g) => !isSecureBay(g)), [grids])

  const liveSteps = useMemo(
    () => (route ? buildLoadingSteps(contracts, route, order) : []),
    [contracts, route, order]
  )

  // number by drop-off, route order
  const { num: dropNum, color: objColor } = useMemo(() => objectiveStops(route), [route])

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
      // every walk opens on step 0: empty ship at the depot, park crates, head out
      setFrozenSteps((prev) => {
        if (prev) return prev
        const first = liveSteps[0]
        const step0: LoadingStep = {
          nodeKey: '__start__',
          label: startLocation || first?.label || 'START',
          code: '',
          region: '',
          trip: first?.trip ?? 0,
          start: true,
          kind: 'load',
          boundFor: '',
          groupPos: 0,
          groupTotal: 0,
          lines: [],
          loadIds: [],
          dropIds: []
        }
        return [step0, ...liveSteps]
      })
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
  const looseAt = useStore((s) => s.looseAt)
  const setObjectiveDeferred = useStore((s) => s.setObjectiveDeferred)
  const loadedPins = useStore((s) => s.loadedPins)
  const addLoadedPins = useStore((s) => s.addLoadedPins)
  const resetWalkDecisions = useStore((s) => s.resetWalkDecisions)
  const storAlls = useStore((s) => s.storAlls)
  const addStorAll = useStore((s) => s.addStorAll)
  const moveStorAll = useStore((s) => s.moveStorAll)
  const removeStorAll = useStore((s) => s.removeStorAll)
  const crates = useMemo(() => storAlls[activeShip] ?? [], [storAlls, activeShip])
  const fixtures = useMemo(() => (crates.length ? fixtureMap(crates) : undefined), [crates])
  const packEnvRef = useRef<{
    events: ReturnType<typeof buildLoadEvents>
    looseIds: Set<string>
    pins: Map<string, Placement>
    source: PackBox[]
  } | null>(null)
  const loadingPack = useMemo(() => {
    if (!loadSteps.length) return null
    const source = frozenBoxes ?? applyDropSeq(packBoxes(contracts, order, true) as PackBox[])
    const events = buildLoadEvents(loadSteps, source)
    const looseIds = new Set(source.filter((b) => looseBoxes.includes(boxKey(b))).map((b) => b.id))
    // cargo already aboard is locked at the spot it was loaded; re-plans pack
    // around it. Extents follow the bay's floor axis, not a blanket y-up
    const pins = new Map<string, Placement>()
    for (const b of source) {
      const lp = loadedPins[boxKey(b)]
      const dims = BOX_DIMS[b.size]
      if (!lp || !dims) continue
      const g = grids.find((x) => x.id === lp.gridId)
      const ext =
        lp.w && lp.h && lp.l
          ? ([lp.w, lp.h, lp.l] as [number, number, number])
          : g
            ? extentsFor(g, dims, lp.rotated)
            : ([lp.rotated ? dims.l : dims.w, dims.h, lp.rotated ? dims.w : dims.l] as [number, number, number])
      pins.set(b.id, { box: b, gridId: lp.gridId, x: lp.x, y: lp.y, z: lp.z, w: ext[0], l: ext[2], h: ext[1], rotated: lp.rotated })
    }
    const whole = planHold(grids, events, {
      loose: looseIds,
      pins: pins.size ? pins : undefined,
      fixtures,
      gap: spaceDeliveryPiles ? 1 : 0
    })
    const raw = whole.snaps
    // commitDrag probes hypothetical pins against this exact environment
    packEnvRef.current = { events, looseIds, pins, source }
    const snaps = raw.map((s) => ({
      placements: s.placements,
      unplaced: s.unplaced,
      loose: s.loose,
      count: s.placements.length + s.unplaced.length
    }))
    return { snaps, stepBoxes: events.map((e) => e.load), conc: whole.concessions.length }
  }, [loadSteps, grids, contracts, order, frozenBoxes, looseBoxes, loadedPins, fixtures, spaceDeliveryPiles])

  // which pickup each aboard box arrived on, so freezing the layout can pin a
  // box under the same key it would carry if you'd hand-placed it there
  const pickupKeyById = useMemo(() => {
    const m = new Map<string, string>()
    if (!loadingPack) return m
    loadSteps.forEach((s, i) => {
      const pk = pickupVisitKey(s.nodeKey, s.trip)
      for (const b of loadingPack.stepBoxes[i] ?? []) if (!m.has(b.id)) m.set(b.id, pk)
    })
    return m
  }, [loadingPack, loadSteps])

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
    const { homes } = packRun(grids, boxes, { gap: spaceDeliveryPiles ? 1 : 0, fixtures })
    return boxes.map((b) => freezeBox(objMeta, b, homes.get(b.id)))
  }, [livePack, grids, objMeta, spaceDeliveryPiles, fixtures])
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

  // blink detector: a replan must never change what's visible at the same
  // step. When it does, name the boxes and the inputs that moved, so a report
  // carries the cause instead of another round of guessing
  const blinkRef = useRef<{ idx: number; ids: Set<string>; pins: number; loose: number; steps: number } | null>(null)
  useEffect(() => {
    if (!loading || !loadingPack || !loadingPack.snaps.length) {
      blinkRef.current = null
      return
    }
    const at = Math.min(Math.max(0, loadIdx), loadingPack.snaps.length - 1)
    const ids = new Set(loadingPack.snaps[at]?.placements.map((p) => boxKey(p.box)) ?? [])
    const was = blinkRef.current
    blinkRef.current = { idx: at, ids, pins: Object.keys(loadedPins).length, loose: looseBoxes.length, steps: loadSteps.length }
    if (!was || was.idx !== at) return
    const gone = [...was.ids].filter((k) => !ids.has(k))
    const came = [...ids].filter((k) => !was.ids.has(k))
    if (!gone.length && !came.length) return
    console.warn(
      `[blink] step ${at + 1}: gone [${gone.join(', ')}] came [${came.join(', ')}] | pins ${was.pins}->${Object.keys(loadedPins).length} loose ${was.loose}->${looseBoxes.length} steps ${was.steps}->${loadSteps.length}`
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadingPack, loadIdx])
  const visiblePlacements = result.placements
  const shownScu = useMemo(() => visiblePlacements.reduce((a, p) => a + p.box.size, 0), [visiblePlacements])
  const visibleCount = result.placements.length + result.unplaced.length

  // bounds over visible grids, plus the off-grid pane so it stays in frame.
  // shipHalf/shipCenter stay ship-only so the floor labels sit on the ship, not out by the pane
  const { origin, span, half, shipHalf, shipCenter, offGrid: offGridBay } = useMemo(() => {
    if (!shownGrids.length) return { origin: [0, 0, 0] as [number, number, number], span: 10, half: [5, 5, 5] as [number, number, number], shipHalf: [5, 5, 5] as [number, number, number], shipCenter: [0, 0, 0] as [number, number, number], offGrid: null }
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (const g of shownGrids) {
      minX = Math.min(minX, g.x || 0); maxX = Math.max(maxX, (g.x || 0) + g.w)
      minY = Math.min(minY, g.y || 0); maxY = Math.max(maxY, (g.y || 0) + g.h)
      minZ = Math.min(minZ, g.z || 0); maxZ = Math.max(maxZ, (g.z || 0) + g.l)
    }
    const shipMinX = minX, shipMinY = minY, shipMinZ = minZ, shipMaxX = maxX, shipMaxY = maxY, shipMaxZ = maxZ
    // park the pane past the ship's starboard edge, on the deck, centered on the hold's length
    const off: CargoGrid | null = offPad && {
      id: OFF_GRID_ID, name: 'OFF GRID', source: 'override', autoLoad: false,
      x: maxX + OFF_GAP, y: minY, z: minZ + (maxZ - minZ - offPad.l) / 2,
      w: offPad.w, l: offPad.l, h: offPad.h, scu: offPad.w * offPad.l * offPad.h
    }
    if (off) {
      maxX = Math.max(maxX, off.x + off.w)
      maxY = Math.max(maxY, off.y + off.h)
      minZ = Math.min(minZ, off.z); maxZ = Math.max(maxZ, off.z + off.l)
    }
    const o: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
    return {
      origin: o,
      span: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 6),
      half: [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2] as [number, number, number],
      shipHalf: [(shipMaxX - shipMinX) / 2, (shipMaxY - shipMinY) / 2, (shipMaxZ - shipMinZ) / 2] as [number, number, number],
      shipCenter: [(shipMinX + shipMaxX) / 2 - o[0], (shipMinY + shipMaxY) / 2 - o[1], (shipMinZ + shipMaxZ) / 2 - o[2]] as [number, number, number],
      offGrid: off
    }
  }, [shownGrids, offPad])

  // lay the loose boxes out in the pane: parked ones keep their spot, the rest
  // auto-shelve on the deck, front-to-back, so a legacy stash still shows somewhere.
  // Everything runs in a stable key order so the layout is the same every render,
  // and a spot that no longer fits drops onto whatever's under it instead of
  // interpenetrating a neighbour
  const loosePlacements = useMemo<Placement[]>(() => {
    if (!offGridBay || !looseNow.length) return []
    const pw = offGridBay.w, pl = offGridBay.l, ph = offGridBay.h
    const occ = new Set<string>()
    const mark = (x: number, y: number, z: number, w: number, l: number, h: number): void => {
      for (let dy = 0; dy < h; dy++) for (let dz = 0; dz < l; dz++) for (let dx = 0; dx < w; dx++) occ.add(`${x + dx},${y + dy},${z + dz}`)
    }
    const fits = (x: number, y: number, z: number, w: number, l: number, h: number): boolean => {
      if (x < 0 || z < 0 || x + w > pw || z + l > pl || y + h > ph) return false
      for (let dy = 0; dy < h; dy++) for (let dz = 0; dz < l; dz++) for (let dx = 0; dx < w; dx++) if (occ.has(`${x + dx},${y + dy},${z + dz}`)) return false
      return true
    }
    // lowest free y at this footprint, so a stale spot lands on top of its neighbour
    const settle = (x: number, z: number, w: number, l: number, h: number): number => {
      for (let y = 0; y + h <= ph; y++) if (fits(x, y, z, w, l, h)) return y
      return -1
    }
    const boxes = [...looseNow].sort((a, c) => boxKey(a).localeCompare(boxKey(c)))
    const out: Placement[] = []
    const shelf: PackBox[] = []
    // seat parked boxes first so auto-shelf works around them
    for (const b of boxes) {
      const dims = BOX_DIMS[b.size]
      if (!dims) continue
      const sp = looseSpots[boxKey(b)]
      if (sp && sp.gridId === OFF_GRID_ID) {
        const w = sp.rotated ? dims.l : dims.w
        const l = sp.rotated ? dims.w : dims.l
        // keep the stored spot when it's still clear; otherwise settle down its
        // column onto whatever moved in under it
        const inPane = sp.x >= 0 && sp.z >= 0 && sp.x + w <= pw && sp.z + l <= pl
        const y = inPane
          ? fits(sp.x, sp.y, sp.z, w, l, dims.h)
            ? sp.y
            : settle(sp.x, sp.z, w, l, dims.h)
          : -1
        if (y >= 0) {
          mark(sp.x, y, sp.z, w, l, dims.h)
          out.push({ box: b, gridId: OFF_GRID_ID, x: sp.x, y, z: sp.z, w, l, h: dims.h, rotated: !!sp.rotated })
          continue
        }
      }
      shelf.push(b)
    }
    for (const b of shelf) {
      const dims = BOX_DIMS[b.size]
      if (!dims) continue
      let placed = false
      for (let y = 0; y < ph && !placed; y++)
        for (let z = 0; z <= pl - dims.l && !placed; z++)
          for (let x = 0; x <= pw - dims.w && !placed; x++)
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
  // what the open pickup needs the user to settle: won't-fit (must stash or come
  // back) or dig-out (a heads-up). Drives the red overlay AND the advance gate.
  const currentDecision = useMemo(() => {
    if (currentLoad?.kind !== 'load') return null
    return bucketDecision(setAside, result.unplaced, new Set(currentLoad.loadIds))
  }, [currentLoad, setAside, result])
  // won't-fit has no "load anyway": stash or leave, so hold NEXT until they do.
  // dig-out has a valid "load it now", but it's still a call to make, so hold NEXT
  // until they pick load-and-dig or come-back (acknowledged per step).
  const [decidedIdx, setDecidedIdx] = useState<number | null>(null)
  const blockKind: 'overload' | 'digout' | null =
    currentDecision?.kind === 'overload'
      ? 'overload'
      : currentDecision?.kind === 'digout' && decidedIdx !== loadIdx
        ? 'digout'
        : null
  // cargo you'd dig to reach: lit red ONLY on the step whose DIG-OUT warning is
  // showing, so it's a heads-up for this load decision, not a permanent state.
  // live within the step, so restacking to clear the dig-out drops the red
  const blockedKeys = useMemo(() => {
    if (currentDecision?.kind !== 'digout') return new Set<string>()
    return new Set(setAside.blocked.map((b) => boxKey(b)))
  }, [currentDecision, setAside])
  // green outline of where the plan wants this step's boxes, one box per bay.
  // frozen when the step opens so it keeps showing the recommendation even after
  // the user drags cargo off it. keyed by step so a rewind or advance recaptures
  type Footprint = { gridId: string; x: number; y: number; z: number; w: number; l: number; h: number }
  const footprintRef = useRef<{ idx: number; boxes: Footprint[] } | null>(null)
  const planFootprint = useMemo<Footprint[]>(() => {
    if (!loading || currentLoad?.kind !== 'load' || !loadingPack) {
      footprintRef.current = null
      return []
    }
    if (footprintRef.current?.idx === loadIdx) return footprintRef.current.boxes
    const ids = new Set(currentLoad.loadIds)
    const snap = loadingPack.snaps[loadIdx]
    const mine = snap ? snap.placements.filter((p) => p.box.objectiveId && ids.has(p.box.objectiveId)) : []
    const byBay = new Map<string, { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }>()
    for (const p of mine) {
      const b = byBay.get(p.gridId)
      if (!b) byBay.set(p.gridId, { x0: p.x, y0: p.y, z0: p.z, x1: p.x + p.w, y1: p.y + p.h, z1: p.z + p.l })
      else {
        b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y); b.z0 = Math.min(b.z0, p.z)
        b.x1 = Math.max(b.x1, p.x + p.w); b.y1 = Math.max(b.y1, p.y + p.h); b.z1 = Math.max(b.z1, p.z + p.l)
      }
    }
    const boxes: Footprint[] = [...byBay].map(([gridId, b]) => ({ gridId, x: b.x0, y: b.y0, z: b.z0, w: b.x1 - b.x0, l: b.z1 - b.z0, h: b.y1 - b.y0 }))
    footprintRef.current = { idx: loadIdx, boxes }
    return boxes
    // capture once per step: dragging must not move the recommendation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadIdx, currentLoad])
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

  // if it fits, it sits: a return-visit pickup that packs cleanly into the
  // hold as it stands right now just joins this stop's list. The card only
  // asks when the fit is volume-only and the stack would get ugly
  const grabbedOnce = useRef('')
  const [grabAsk, setGrabAsk] = useState(false)
  useEffect(() => {
    grabbedOnce.current = ''
    setGrabAsk(false)
  }, [loadIdx])
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
  const [dropNotice, setDropNotice] = useState<string | null>(null)
  const [shelfOpen, setShelfOpen] = useState(false)
  useEffect(() => {
    if (!dropNotice) return
    const t = setTimeout(() => setDropNotice(null), 5000)
    return () => clearTimeout(t)
  }, [dropNotice])
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
  // ship-coord cursor; held box follows
  const [dragPos, setDragPos] = useState<{ x: number; z: number } | null>(null)
  const [dragRot, setDragRot] = useState(false)
  const lastPt = useRef<{ x: number; z: number } | null>(null)

  useEffect(() => {
    if (!loading || !grabOffer || !loadingPack || !frozenSteps || drag) return
    const env = packEnvRef.current
    if (!env) return
    if (grabbedOnce.current) return
    grabbedOnce.current = '1'
    const steps2 = filterDeferredSteps(
      frozenSteps,
      new Set(deferredObjectives),
      (id) => tickedObj.has(id),
      new Set([...grabbedObjectives, ...grabOffer.ids])
    )
    const probe = planHold(grids, buildLoadEvents(steps2, env.source), {
      loose: env.looseIds.size ? env.looseIds : undefined,
      pins: env.pins.size ? env.pins : undefined,
      fixtures,
      gap: spaceDeliveryPiles ? 1 : 0
    })
    const base = new Set<string>()
    for (const s of loadingPack.snaps) for (const u of s.unplaced) base.add(u.id)
    // volume said yes but the stack says no: someone never finds a seat.
    // That's not an offer, so no card either
    for (const s of probe.snaps) for (const u of s.unplaced) if (!base.has(u.id)) return
    if (probe.concessions.length > loadingPack.conc) setGrabAsk(true)
    else grabOffer.ids.forEach((id) => setObjectiveGrabbed(id, true))
  }, [loading, grabOffer, loadingPack, frozenSteps, drag, loadIdx, deferredObjectives, tickedObj, grabbedObjectives, grids, fixtures, setObjectiveGrabbed])

  const dragKeys = useMemo(
    () => (drag ? new Set(group ? group.map((m) => m.key) : [drag.key]) : null),
    [drag, group]
  )

  // occupied cells, minus whatever's in hand
  const occCells = useMemo(() => {
    const m = new Map<string, Set<string>>()
    const mark = (gridId: string, x: number, y: number, z: number, w: number, h: number, l: number): void => {
      let set = m.get(gridId)
      if (!set) {
        set = new Set()
        m.set(gridId, set)
      }
      for (let dy = 0; dy < h; dy++)
        for (let dz = 0; dz < l; dz++)
          for (let dx = 0; dx < w; dx++) set.add(`${x + dx},${y + dy},${z + dz}`)
    }
    for (const p of result.placements) {
      if (dragKeys?.has(boxKey(p.box))) continue
      mark(p.gridId, p.x, p.y, p.z, p.w, p.h, p.l)
    }
    for (const c of crates) {
      if (dragKeys?.has(c.id)) continue
      mark(c.gridId, c.x, c.y, c.z, c.w, c.h, c.l)
    }
    return m
  }, [result, dragKeys, crates])

  // a dragged crate can rest on the floor or on another crate, never on cargo:
  // cargo columns read as full-height walls so the ghost slides past them
  const crateOcc = useMemo(() => {
    const m = new Map<string, Set<string>>()
    const setOf = (gridId: string): Set<string> => {
      let s = m.get(gridId)
      if (!s) {
        s = new Set()
        m.set(gridId, s)
      }
      return s
    }
    for (const p of result.placements) {
      const g = gridById.get(p.gridId)
      if (!g) continue
      const up = axOf((g.floor ?? 'y-')[0])
      const size = sizeOf(g)
      const set = setOf(p.gridId)
      for (let dy = 0; dy < p.h; dy++)
        for (let dz = 0; dz < p.l; dz++)
          for (let dx = 0; dx < p.w; dx++) {
            const cell = [p.x + dx, p.y + dy, p.z + dz]
            for (let uu = 0; uu < size[up]; uu++) {
              cell[up] = uu
              set.add(`${cell[0]},${cell[1]},${cell[2]}`)
            }
          }
    }
    for (const c of crates) {
      if (dragKeys?.has(c.id)) continue
      const set = setOf(c.gridId)
      for (let dy = 0; dy < c.h; dy++)
        for (let dz = 0; dz < c.l; dz++)
          for (let dx = 0; dx < c.w; dx++) set.add(`${c.x + dx},${c.y + dy},${c.z + dz}`)
    }
    return m
  }, [result, dragKeys, crates, gridById])

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

  const dragRay = useRef<THREE.Ray | null>(null)

  // rest a box against the bay's floor face, or the stack growing off it,
  // whatever axis that floor happens to be on
  const dropOn = (occ: Set<string>, g: CargoGrid, at: [number, number, number], ext: [number, number, number]): [number, number, number] | null => {
    const floor = g.floor ?? 'y-'
    const up = axOf(floor[0])
    const grow = floor[1] === '-' ? 1 : -1
    const size = sizeOf(g)
    const others = [0, 1, 2].filter((a) => a !== up) as [Ax, Ax]
    const free = (p: [number, number, number]): boolean => {
      for (let dx = 0; dx < ext[0]; dx++)
        for (let dy = 0; dy < ext[1]; dy++)
          for (let dz = 0; dz < ext[2]; dz++) if (occ.has(`${p[0] + dx},${p[1] + dy},${p[2] + dz}`)) return false
      return true
    }
    const max = size[up] - ext[up]
    for (let i = 0; i <= max; i++) {
      const u = grow === 1 ? i : max - i
      const p = [...at] as [number, number, number]
      p[up] = u
      if (!free(p)) continue
      if (i === 0) return p
      const lay = grow === 1 ? u - 1 : u + ext[up]
      let held = true
      for (let da = 0; da < ext[others[0]] && held; da++)
        for (let db = 0; db < ext[others[1]] && held; db++) {
          const c = [0, 0, 0]
          c[up] = lay
          c[others[0]] = p[others[0]] + da
          c[others[1]] = p[others[1]] + db
          if (!occ.has(`${c[0]},${c[1]},${c[2]}`)) held = false
        }
      if (held) return p
    }
    return null
  }

  // pointer ray -> fractional local coords on a bay's floor plane. The bay
  // renders spun about its center, so the ray goes through the inverse spin
  // before any cell math; without this a 45deg pallet reads garbage cells
  const tiltedHit = (g: CargoGrid, ray: THREE.Ray): { at: [number, number, number]; t: number } | null => {
    const size = sizeOf(g)
    const min = new THREE.Vector3((g.x || 0) - origin[0], (g.y || 0) - origin[1], (g.z || 0) - origin[2])
    const pivot = min.clone().add(new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2))
    const o = ray.origin.clone().sub(pivot)
    const d = ray.direction.clone()
    const e = bayRot(g)
    if (e) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2])).invert()
      o.applyQuaternion(q)
      d.applyQuaternion(q)
    }
    o.add(pivot)
    const floor = g.floor ?? 'y-'
    const up = axOf(floor[0])
    const planeAt = floor[1] === '-' ? min.getComponent(up) : min.getComponent(up) + size[up]
    const denom = d.getComponent(up)
    if (Math.abs(denom) < 1e-6) return null
    const t = (planeAt - o.getComponent(up)) / denom
    if (t <= 0) return null
    const p = o.addScaledVector(d, t)
    const at: [number, number, number] = [p.x - min.x, p.y - min.y, p.z - min.z]
    for (const a of [0, 1, 2].filter((x) => x !== up)) if (at[a] < -0.75 || at[a] > size[a] + 0.75) return null
    return { at, t }
  }

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

  // slide the footprint around the hovered cell so the whole top face of a
  // support box is a valid stack target, not just its min corner. Candidates are
  // every anchor whose footprint still covers the cursor; the one that rests
  // highest wins, ties nearest the raw anchor so ground drops don't drift
  const bestAnchor = (
    occ: Set<string>, g: CargoGrid, hx: number, hz: number, gw: number, gl: number, fw: number, fl: number, fh: number
  ): { x: number; z: number; y: number } => {
    const rx = Math.max(0, Math.min(gw - fw, hx))
    const rz = Math.max(0, Math.min(gl - fl, hz))
    let best = { x: rx, z: rz, y: dropY(occ, g, rx, rz, fw, fl, fh) }
    for (let dx = 0; dx < fw; dx++)
      for (let dz = 0; dz < fl; dz++) {
        const ax = hx - dx
        const az = hz - dz
        if (ax < 0 || az < 0 || ax + fw > gw || az + fl > gl) continue
        const y = dropY(occ, g, ax, az, fw, fl, fh)
        if (y < 0) continue
        if (y > best.y || best.y < 0) best = { x: ax, z: az, y }
        else if (y === best.y && Math.abs(ax - rx) + Math.abs(az - rz) < Math.abs(best.x - rx) + Math.abs(best.z - rz))
          best = { x: ax, z: az, y }
      }
    return best
  }

  const computeGhost = (shipX: number, shipZ: number): Ghost | null => {
    if (!drag) return null
    const dims = BOX_DIMS[drag.box.size]
    if (!dims) return null
    const anchor = group?.find((m) => m.key === drag.key)
    const fw = anchor ? anchor.w : dragRot ? dims.l : dims.w
    const fl = anchor ? anchor.l : dragRot ? dims.w : dims.l
    const fh = dims.h
    const isCrate = drag.key.startsWith('storall:')
    const cellsOf = (gid: string): Set<string> => (isCrate ? crateOcc.get(gid) : occCells.get(gid)) ?? new Set()
    // spun or re-floored bays aim through the pointer ray at their own floor
    // plane; the ground-plane projection below never lands on a 45deg pallet.
    // Nearest hit wins
    if (dragRay.current) {
      let hitBest: { g: CargoGrid; at: [number, number, number]; t: number } | null = null
      for (const g of grids) {
        if (g.autoLoad === false || (!g.rot && (g.floor ?? 'y-') === 'y-')) continue
        const hit = tiltedHit(g, dragRay.current)
        if (hit && (!hitBest || hit.t < hitBest.t)) hitBest = { g, at: hit.at, t: hit.t }
      }
      if (hitBest && group) {
        // the formation's flat offsets map onto the bay's two floor-plane
        // axes; each member rests on its own support, earlier members count
        // as floor for the ones above
        const g = hitBest.g
        const size = sizeOf(g)
        const floor = g.floor ?? 'y-'
        const up = axOf(floor[0])
        const others = [0, 1, 2].filter((a) => a !== up) as [Ax, Ax]
        const a0 = Math.floor(hitBest.at[others[0]])
        const b0 = Math.floor(hitBest.at[others[1]])
        const occ = new Set(cellsOf(g.id))
        const members: GhostSpot[] = []
        let valid = true
        let anchorAt: [number, number, number] | null = null
        for (const m of group) {
          const md = BOX_DIMS[m.box.size]
          const ext = md ? extentsFor(g, md, m.rotated) : ([m.w, m.h, m.l] as [number, number, number])
          const cell = [0, 0, 0] as [number, number, number]
          cell[others[0]] = a0 + m.dx
          cell[others[1]] = b0 + m.dz
          const inside =
            cell[others[0]] >= 0 && cell[others[1]] >= 0 &&
            cell[others[0]] + ext[others[0]] <= size[others[0]] &&
            cell[others[1]] + ext[others[1]] <= size[others[1]]
          const got = inside ? dropOn(occ, g, cell, ext) : null
          if (!got) valid = false
          else
            for (let ax = 0; ax < ext[0]; ax++)
              for (let ay = 0; ay < ext[1]; ay++)
                for (let az = 0; az < ext[2]; az++) occ.add(`${got[0] + ax},${got[1] + ay},${got[2] + az}`)
          const at = got ?? cell
          if (m.key === drag.key) anchorAt = at
          members.push({ key: m.key, x: at[0], y: at[1], z: at[2], w: ext[0], l: ext[2], h: ext[1], rotated: m.rotated })
        }
        const a = anchorAt ?? [0, 0, 0]
        const anchorSpot = members.find((mm) => mm.key === drag.key)
        return { gridId: g.id, x: a[0], y: a[1], z: a[2], w: anchorSpot?.w ?? fw, h: anchorSpot?.h ?? fh, l: anchorSpot?.l ?? fl, valid, members }
      }
      if (hitBest) {
        const g = hitBest.g
        const ext = extentsFor(g, dims, dragRot)
        const size = sizeOf(g)
        const floor = g.floor ?? 'y-'
        const up = axOf(floor[0])
        const grow = floor[1] === '-' ? 1 : -1
        const others = [0, 1, 2].filter((a) => a !== up) as [Ax, Ax]
        const raw = [0, 0, 0] as [number, number, number]
        for (const a of others) raw[a] = Math.max(0, Math.min(size[a] - ext[a], Math.floor(hitBest.at[a])))
        const occ = cellsOf(g.id)
        // slide the footprint around the aim so a stack's whole face is a target
        let spot: [number, number, number] | null = null
        let deep = -1
        let near = Infinity
        for (let da = 0; da < ext[others[0]]; da++)
          for (let db = 0; db < ext[others[1]]; db++) {
            const c = [0, 0, 0] as [number, number, number]
            c[others[0]] = Math.floor(hitBest.at[others[0]]) - da
            c[others[1]] = Math.floor(hitBest.at[others[1]]) - db
            if (c[others[0]] < 0 || c[others[1]] < 0) continue
            if (c[others[0]] + ext[others[0]] > size[others[0]] || c[others[1]] + ext[others[1]] > size[others[1]]) continue
            const got = dropOn(occ, g, c, ext)
            if (!got) continue
            const depth = grow === 1 ? got[up] : size[up] - ext[up] - got[up]
            const dist = Math.abs(c[others[0]] - raw[others[0]]) + Math.abs(c[others[1]] - raw[others[1]])
            if (depth > deep || (depth === deep && dist < near)) {
              spot = got
              deep = depth
              near = dist
            }
          }
        if (!spot) {
          const flat = [...raw] as [number, number, number]
          flat[up] = grow === 1 ? 0 : size[up] - ext[up]
          return { gridId: g.id, x: flat[0], y: flat[1], z: flat[2], w: ext[0], h: ext[1], l: ext[2], valid: false }
        }
        return { gridId: g.id, x: spot[0], y: spot[1], z: spot[2], w: ext[0], h: ext[1], l: ext[2], valid: true }
      }
    }
    // a crate stays aboard; it comes off via the shelf, not the pane
    if (offGridBay && !isCrate) {
      const gx = offGridBay.x
      const gz = offGridBay.z
      if (shipX >= gx && shipX < gx + offGridBay.w && shipZ >= gz && shipZ < gz + offGridBay.l) {
        if (!group) {
          const b = bestAnchor(offOcc, offGridBay, Math.floor(shipX - gx), Math.floor(shipZ - gz), offGridBay.w, offGridBay.l, fw, fl, fh)
          return { gridId: OFF_GRID_ID, x: b.x, y: b.y < 0 ? 0 : b.y, z: b.z, w: fw, l: fl, h: fh, valid: b.y >= 0 }
        }
        // whole group onto the pad, same offsets, each box to its own support
        const lx = Math.max(0, Math.min(offGridBay.w - fw, Math.floor(shipX - gx)))
        const lz = Math.max(0, Math.min(offGridBay.l - fl, Math.floor(shipZ - gz)))
        const occ = new Set(offOcc)
        const members: GhostSpot[] = []
        let valid = true
        let ay = 0
        for (const m of group) {
          const mx = lx + m.dx
          const mz = lz + m.dz
          const inside = mx >= 0 && mz >= 0 && mx + m.w <= offGridBay.w && mz + m.l <= offGridBay.l
          const y = inside ? dropY(occ, offGridBay, mx, mz, m.w, m.l, m.h) : -1
          if (y < 0) valid = false
          else
            for (let dy = 0; dy < m.h; dy++)
              for (let dz = 0; dz < m.l; dz++)
                for (let dx = 0; dx < m.w; dx++) occ.add(`${mx + dx},${y + dy},${mz + dz}`)
          if (m.key === drag.key) ay = y < 0 ? 0 : y
          members.push({ key: m.key, x: mx, y: y < 0 ? 0 : y, z: mz, w: m.w, l: m.l, h: m.h, rotated: m.rotated })
        }
        return { gridId: OFF_GRID_ID, x: lx, y: ay, z: lz, w: fw, l: fl, h: fh, valid, members }
      }
    }
    for (const g of grids) {
      // spun/re-floored bays only take drops through the ray path above
      if (g.autoLoad === false || g.rot || (g.floor ?? 'y-') !== 'y-') continue
      const gx = g.x || 0
      const gz = g.z || 0
      if (shipX < gx || shipX >= gx + g.w || shipZ < gz || shipZ >= gz + g.l) continue
      const lx = Math.max(0, Math.min(g.w - fw, Math.floor(shipX - gx)))
      const lz = Math.max(0, Math.min(g.l - fl, Math.floor(shipZ - gz)))
      if (!group) {
        const b = bestAnchor(cellsOf(g.id), g, Math.floor(shipX - gx), Math.floor(shipZ - gz), g.w, g.l, fw, fl, fh)
        return { gridId: g.id, x: b.x, y: b.y < 0 ? 0 : b.y, z: b.z, w: fw, l: fl, h: fh, valid: b.y >= 0 }
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

  const handleDragMove = (shipX: number, shipZ: number, ray?: THREE.Ray): void => {
    lastPt.current = { x: shipX, z: shipZ }
    if (ray) dragRay.current = ray.clone()
    setDragPos({ x: shipX, z: shipZ })
    setGhost(computeGhost(shipX, shipZ))
  }

  // the route only re-solves when its inputs change: which pickups ride
  // (defer/grab), what's stashed off-grid, the crates eating space. Rearranging
  // boxes changes none of that, so it never triggers one.
  const compositionSig = (): string =>
    JSON.stringify({
      d: [...deferredObjectives].sort(),
      g: [...grabbedObjectives].sort(),
      l: [...looseBoxes].sort(),
      c: crates.map((c) => c.size).sort((a, b) => a - b)
    })
  const lastSolvedSig = useRef('')
  useEffect(() => {
    if (loading) lastSolvedSig.current = compositionSig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // a plan that went off the rails gets thrown away, never argued with: the
  // stops ahead re-solve from where the ship sits, cargo aboard seeded, walked
  // steps kept as history. replanCurrent also hands the OPEN step back to the
  // router (its pickup wouldn't seat), letting it defer or re-split
  const resolveTail = (fx?: Map<string, Placement>, replanCurrent = false): void => {
    const cur = loadSteps[loadIdx]
    if (!loading || !frozenSteps || !cur) return
    const aboard = new Set<string>()
    // seed aboard from what's actually in the hold right now (the live snap), not
    // from pins: a delivered box's pin can outlive its walked drop step, and
    // seeding it would re-board already-delivered cargo and re-emit its delivery
    const curIds = new Set(cur.kind === 'load' ? cur.loadIds : [])
    for (const p of loadingPack?.snaps[loadIdx]?.placements ?? []) {
      const oid = p.box.objectiveId
      if (oid && !(replanCurrent && curIds.has(oid))) aboard.add(oid)
    }
    if (!replanCurrent && cur.kind === 'load') for (const id of cur.loadIds) aboard.add(id)
    const tailRoute = computeRoutePlan(
      contracts.filter((c) => !c.pendingOcr),
      locations,
      gridCapacity(activeShip, installed),
      cur.label,
      loadableGrids(activeShip, installed),
      undefined,
      deferredObjectives,
      aboard,
      cur.nodeKey,
      fx ?? fixtures
    )
    if (!tailRoute) return
    let tail = buildLoadingSteps(contracts, tailRoute, order)
    const prefix = loadSteps.slice(0, replanCurrent ? loadIdx : loadIdx + 1)
    if (!replanCurrent) {
      // the tail re-plans this visit's remaining work; anything the open card
      // already covers would walk twice
      const curIds = new Set([...cur.loadIds, ...cur.dropIds])
      while (tail.length && tail[0].nodeKey === cur.nodeKey && tail[0].lines.every((l) => curIds.has(l.objectiveId)))
        tail = tail.slice(1)
    }
    // visit keys must stay unique across the splice
    const tripBase = Math.max(0, ...prefix.map((s) => s.trip)) + 1
    tail = tail.map((s) => ({ ...s, trip: s.trip + tripBase }))
    // the tail's leading steps at this node ARE the visit the user stands at;
    // a re-minted trip there orphans every pin made at this stop
    for (const s of tail) {
      if (s.nodeKey !== cur.nodeKey) break
      s.trip = cur.trip
    }
    const combined = prefix.concat(tail)
    // depth order follows the new drop order
    const dn = new Map<string, number>()
    let n = 0
    for (const st of combined) {
      if (st.kind !== 'drop') continue
      for (const oid of st.dropIds) if (!dn.has(oid)) dn.set(oid, n)
      n++
    }
    setFrozenSteps(combined)
    if (frozenBoxes)
      setFrozenBoxes(
        frozenBoxes.map((b) => {
          const nn = b.objectiveId ? dn.get(b.objectiveId) : undefined
          return nn == null ? b : { ...b, stopIdx: nn }
        })
      )
  }

  // does the open step's own cargo have a box with no seat?
  const curUnfit = useMemo(() => {
    if (!loading || !loadingPack) return false
    const cur = loadSteps[loadIdx]
    if (!cur || cur.kind !== 'load' || !cur.loadIds.length) return false
    const snap = loadingPack.snaps[loadIdx]
    if (!snap?.unplaced.length) return false
    const mine = new Set((loadingPack.stepBoxes[loadIdx] ?? []).map((b) => b.id))
    return snap.unplaced.some((u) => mine.has(u.id) && !looseBoxes.includes(boxKey(u)))
  }, [loading, loadingPack, loadIdx, loadSteps, looseBoxes])

  // a won't-fit step gets the router one shot at re-splitting or deferring the
  // overflow the moment you arrive; just once, before the card asks you to decide, so
  // the card and the held NEXT button reflect what actually can't fit. One shot
  // per step: a second pass on the re-solved plan is how the feedback storms start
  const negotiatedStep = useRef(-1)
  useEffect(() => {
    if (!loading || !loadingPack || drag) return
    if (!curUnfit || negotiatedStep.current === loadIdx) return
    negotiatedStep.current = loadIdx
    resolveTail(undefined, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadingPack, curUnfit, drag, loadIdx])

  // moving one box shouldn't shuffle the rest. Pin every box still standing on
  // its own feet where it sits, so the re-pack echoes the layout instead of
  // re-dealing it. Boxes that were riding on what you just moved are left out -
  // they lost their footing, so the packer settles them straight down.
  const freezeVisible = (moved: Set<string>): Record<string, LoadedPin> => {
    if (!loading) return {}
    const cells: Cell[] = result.placements
      .filter((p) => !moved.has(boxKey(p.box)))
      .map((p) => ({ key: boxKey(p.box), gridId: p.gridId, x: p.x, y: p.y, z: p.z, w: p.w, l: p.l, h: p.h }))
    // crates are permanent platforms: a box perched on one still has its footing
    const platforms = new Set<string>()
    for (const c of crates) {
      const key = `crate:${c.id}`
      platforms.add(key)
      cells.push({ key, gridId: c.gridId, x: c.x, y: c.y, z: c.z, w: c.w, l: c.l, h: c.h })
    }
    const grounded = groundedSet(cells, gridById, platforms)
    const pins: Record<string, LoadedPin> = {}
    for (const p of result.placements) {
      const key = boxKey(p.box)
      if (moved.has(key) || !grounded.has(key)) continue
      const pk = loadedPins[key]?.pickupKey ?? pickupKeyById.get(p.box.id)
      if (!pk) continue
      pins[key] = { gridId: p.gridId, x: p.x, y: p.y, z: p.z, w: p.w, l: p.l, h: p.h, rotated: p.rotated, pickupKey: pk }
    }
    return pins
  }

  const commitDrag = (): void => {
    setDrag((d) => {
      if (d && ghost && ghost.valid) {
        const spots = ghost.members ?? [{ key: d.key, x: ghost.x, y: ghost.y, z: ghost.z, w: ghost.w, l: ghost.l, h: ghost.h, rotated: dragRot }]
        if (d.key.startsWith('storall:')) {
          // your crate always lands where you drop it; the route re-plans around
          // the space it takes at the next checkpoint, never under your hands
          const isNew = d.key.startsWith('storall:new')
          const id = isNew ? `storall:${Date.now().toString(36)}` : d.key
          const crate: StorAllCrate = { id, size: d.box.size, gridId: ghost.gridId, x: ghost.x, y: ghost.y, z: ghost.z, w: ghost.w, l: ghost.l, h: ghost.h }
          if (isNew) addStorAll(crate)
          else moveStorAll(d.key, crate)
        } else if (ghost.gridId === OFF_GRID_ID) {
          // dropped into the pane: it rides loose here, out of the plan; a
          // stale pin would keep haunting the bay it left
          const at = currentLoad?.kind === 'load' ? pickupVisitKey(currentLoad.nodeKey, currentLoad.trip) : undefined
          const moved = new Set(spots.map((s) => s.key))
          for (const s of spots) {
            if (loadedPins[s.key]) clearLoadedPin(s.key)
            setBoxLoose(s.key, true, at)
            setLooseSpot(s.key, { gridId: OFF_GRID_ID, x: s.x, y: s.y, z: s.z, rotated: s.rotated })
          }
          const frozen = freezeVisible(moved)
          if (Object.keys(frozen).length) addLoadedPins(frozen)
        } else {
          // placing a box pins it there and nothing else moves; the future only
          // re-packs when you advance. a box pulled off the pane rejoins the plan,
          // loaded now. an already-aboard box keeps the pickup it arrived on; a
          // fresh one takes this step's, so restacking works on a drop step too
          const here = currentLoad?.kind === 'load' ? pickupVisitKey(currentLoad.nodeKey, currentLoad.trip) : undefined
          const moved = new Set(spots.map((s) => s.key))
          const pins: Record<string, LoadedPin> = freezeVisible(moved)
          for (const s of spots) {
            const pk = loadedPins[s.key]?.pickupKey ?? here
            if (!pk) continue
            pins[s.key] = { gridId: ghost.gridId, x: s.x, y: s.y, z: s.z, w: s.w, l: s.l, h: s.h, rotated: s.rotated, pickupKey: pk }
          }
          if (Object.keys(pins).length) {
            for (const key of Object.keys(pins)) if (looseBoxes.includes(key)) setBoxLoose(key, false)
            addLoadedPins(pins)
          }
        }
        if (ghost.members) setSel(new Set())
      }
      return null
    })
    setGroup(null)
    setGhost(null)
    setDragPos(null)
    lastPt.current = null
    dragRay.current = null
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
    } else {
      if (sel.size) setSel(new Set())
      setDragRot(loadedPins[key]?.rotated ?? pl.rotated)
    }
    setDrag({ key, box: pl.box })
    const sx = (g.x || 0) + pl.x + pl.w / 2
    const sz = (g.z || 0) + pl.z + pl.l / 2
    setDragPos({ x: sx, z: sz })
    lastPt.current = { x: sx, z: sz }
    setGhost(null)
  }

  const crateBox = (id: string, size: number): PackBox => ({ id, size, color: STOR_BODY, dest: '', stopIdx: -1 })

  const startCrateDrag = (c: StorAllCrate, g: CargoGrid, e: ThreeEvent): void => {
    const ne = e.nativeEvent
    if (ne.ctrlKey || ne.metaKey || ne.shiftKey) return
    setHover(null)
    if (sel.size) setSel(new Set())
    setDragRot(false)
    setDrag({ key: c.id, box: crateBox(c.id, c.size) })
    const sx = (g.x || 0) + c.x + c.w / 2
    const sz = (g.z || 0) + c.z + c.l / 2
    setDragPos({ x: sx, z: sz })
    lastPt.current = { x: sx, z: sz }
    setGhost(null)
  }

  // shelf hand-off: pointer goes down on a template, the crate rides the
  // cursor onto the grid and lands on release
  const spawnCrate = (size: number): void => {
    setHover(null)
    if (sel.size) setSel(new Set())
    setDragRot(false)
    setDrag({ key: `storall:new#${size}`, box: crateBox(`storall:new#${size}`, size) })
    setDragPos(null)
    lastPt.current = null
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

  // first walk-step index bearing each pickup key / objective, so a rewind can
  // tell which decisions were made past where the cursor landed
  const stepPos = useMemo(() => {
    const byPickup = new Map<string, number>()
    const byObjective = new Map<string, number>()
    loadSteps.forEach((s, i) => {
      const pk = pickupVisitKey(s.nodeKey, s.trip)
      if (!byPickup.has(pk)) byPickup.set(pk, i)
      if (s.kind === 'load') for (const id of s.loadIds) if (!byObjective.has(id)) byObjective.set(id, i)
    })
    return { byPickup, byObjective }
  }, [loadSteps])

  // a pin must belong to a step at or behind the cursor. Anything else is a
  // squatter from a dead walk (re-minted trip numbers, an older freeze, a
  // resumed session) eating hold space the plan can't see past
  useEffect(() => {
    if (!loading || !frozenSteps) return
    for (const [key, p] of Object.entries(loadedPins)) {
      // unknown key = squatter from a dead walk. Ahead-of-cursor pins are the
      // back-unwind's job; clearing them here races the re-solve splices
      if (!stepPos.byPickup.has(p.pickupKey)) clearLoadedPin(key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, frozenSteps, stepPos, loadedPins])

  // every box that lands on the grid gets pinned the moment it shows, so the
  // re-solver can never shuffle it: only a drag or gravity moves it after. A
  // delivery can still pull the floor from under locked cargo; the snap shows
  // it settled, and moving the pin down with it makes that real, so later stops
  // plan around where the box actually sits instead of the hole it left.
  useEffect(() => {
    if (!loading || !loadingPack || drag) return
    const snap = loadingPack.snaps[loadIdx]
    if (!snap) return
    // a delivered box's pin outlives its drop step. Left in place, the packer
    // re-seats it as a phantom anchor at its old spot, and anchors skip the
    // overlap check, so a live box can end up inside it (box-in-box). Prune any
    // pin whose cargo is no longer aboard at the cursor.
    const active = new Set<string>()
    for (const p of snap.placements) active.add(boxKey(p.box))
    for (const u of snap.unplaced) active.add(boxKey(u))
    for (const b of snap.loose) active.add(boxKey(b))
    for (const key of Object.keys(loadedPins)) if (!active.has(key)) clearLoadedPin(key)
    const moved: Record<string, LoadedPin> = {}
    for (const p of snap.placements) {
      const key = boxKey(p.box)
      const lp = loadedPins[key]
      if (!lp) {
        // fresh on the grid: pin it where the packer just put it
        if (looseBoxes.includes(key)) continue
        const pk = pickupKeyById.get(p.box.id)
        if (pk) moved[key] = { gridId: p.gridId, x: p.x, y: p.y, z: p.z, w: p.w, l: p.l, h: p.h, rotated: p.rotated, pickupKey: pk }
        continue
      }
      if (p.gridId !== lp.gridId || p.x !== lp.x || p.y !== lp.y || p.z !== lp.z)
        moved[key] = { ...lp, gridId: p.gridId, x: p.x, y: p.y, z: p.z, w: p.w, l: p.l, h: p.h, rotated: p.rotated }
    }
    if (Object.keys(moved).length) addLoadedPins(moved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadingPack, loadIdx, drag, loadedPins, looseBoxes, pickupKeyById])

  // rewinding "past" a decision undoes it: pins, stashes, grabs and ticks made
  // at a step now ahead of the cursor reset; deferrals resolve in frozen space
  // since their steps are pruned from the walk. Only fires stepping back, and
  // not when a come-back prunes steps and shifts the cursor to hold its spot
  const prevIdx = useRef(loadIdx)
  const prevLen = useRef(loadSteps.length)
  useEffect(() => {
    const from = prevIdx.current
    const fromLen = prevLen.current
    prevIdx.current = loadIdx
    prevLen.current = loadSteps.length
    if (!loading || loadIdx >= from || loadSteps.length < fromLen) return
    const i = loadIdx

    for (const [key, p] of Object.entries(loadedPins)) {
      const at = stepPos.byPickup.get(p.pickupKey)
      if (at !== undefined && at > i) clearLoadedPin(key)
    }
    for (const [key, pk] of Object.entries(looseAt)) {
      const at = stepPos.byPickup.get(pk)
      if (at !== undefined && at > i) setBoxLoose(key, false)
    }
    for (const id of grabbedObjectives) {
      const at = stepPos.byObjective.get(id)
      if (at !== undefined && at > i) setObjectiveGrabbed(id, false)
    }
    for (let s = i + 1; s < loadSteps.length; s++) {
      const step = loadSteps[s]
      if (step.kind !== 'load') continue
      const key = pickupVisitKey(step.nodeKey, step.trip)
      for (const oid of step.loadIds) {
        const cid = objMeta.get(oid)?.contractId
        if (cid && tickedObj.has(oid)) setPickedUp(cid, oid, key, false)
      }
    }
    if (frozenSteps && deferredObjectives.length) {
      const landed = loadSteps[i]
      const pos = landed
        ? frozenSteps.indexOf(landed) >= 0
          ? frozenSteps.indexOf(landed)
          : frozenSteps.findIndex(
              (f) => f.kind === landed.kind && f.nodeKey === landed.nodeKey && f.trip === landed.trip && f.boundFor === landed.boundFor && f.groupPos === landed.groupPos
            )
        : 0
      if (pos >= 0)
        for (const oid of deferredObjectives) {
          if (tickedObj.has(oid)) continue
          const decisionAt = frozenSteps.findIndex((f) => f.kind === 'load' && f.loadIds.includes(oid))
          if (decisionAt >= pos) setObjectiveDeferred(oid, false)
        }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadIdx, loading])

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
            'No cargo to lay out yet. Add contracts on the Manifest, then come back to load.'
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
          title={result.squeezed ? 'Everything fits, packed tight.' : undefined}
        >
          {over
            ? '▲ OVER CAPACITY (overflow not shown)'
            : result.squeezed
              ? '✓ FITS · PACKED TIGHT'
              : '✓ EVERYTHING FITS'}
        </span>
        {loading && offGrid.count > 0 && (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: F.body, fontSize: 13, color: C.amber }}
            title="Cargo off grid"
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
                ? { order: 2, flex: 1, minHeight: 300 }
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
              canStash={!!offPad}
              blockKind={blockKind}
              onDecide={() => setDecidedIdx(loadIdx)}
              onStashOffGrid={(boxes) => {
                const at = currentLoad?.kind === 'load' ? pickupVisitKey(currentLoad.nodeKey, currentLoad.trip) : undefined
                boxes.forEach((b) => {
                  const key = `${b.objectiveId}#${b.slot}`
                  // a stale pin would keep holding the bay spot it left
                  if (loadedPins[key]) clearLoadedPin(key)
                  setBoxLoose(key, true, at)
                })
              }}
              onComeBack={(ids) => {
                // the deferred pickup's steps vanish from the walk; keep the
                // cursor on the same physical step
                const gone = new Set(ids.filter((id) => !tickedObj.has(id)))
                const shift = loadSteps.slice(0, loadIdx).filter((s) => s.lines.every((l) => gone.has(l.objectiveId))).length
                ids.forEach((id) => setObjectiveDeferred(id, true))
                if (shift) setLoadIdx((i) => Math.max(0, i - shift))
              }}
              grab={grabAsk && grabOffer ? { scu: grabOffer.scu, count: grabOffer.count, stepNo: grabOffer.stepNo } : null}
              onGrab={() => grabOffer?.ids.forEach((id) => setObjectiveGrabbed(id, true))}
              grabbedHere={currentLoad?.kind === 'load' ? currentLoad.loadIds.filter((id) => grabbedObjectives.includes(id)) : []}
              onUngrab={(ids) => ids.forEach((id) => setObjectiveGrabbed(id, false))}
              deferred={deferredLabels}
              onUndoDefer={(id) => setObjectiveDeferred(id, false)}
              capacity={result.capacity}
              reserved={crates.reduce((a, c) => a + c.size, 0)}
              done={done}
              idx={loadIdx}
              total={loadSteps.length}
              turnedIn={turnedIn}
              onTurnIn={(entries) => turnInDestination(entries)}
              onUnmark={(ids) => unmarkTurnIn(ids)}
              onLoaded={() => {
                // loaded step ticks the manifest pickups and locks each box
                // where the plan put it; you can't restack what's aboard
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
                      if (p) pins[boxKey(b)] = { gridId: p.gridId, x: p.x, y: p.y, z: p.z, w: p.w, l: p.l, h: p.h, rotated: p.rotated, pickupKey: key }
                    }
                    addLoadedPins(pins)
                  }
                }
                // gate: the future re-packs only when the plan's inputs changed
                // since the last checkpoint (defer/grab/stash/crates). Just
                // rearranging boxes never lands here; won't-fit already re-solved
                // on arrival. A blocked step can't get here at all.
                const sig = compositionSig()
                if (sig !== lastSolvedSig.current) resolveTail()
                lastSolvedSig.current = sig
                setLoadIdx((i) => i + 1)
              }}
              onBack={() => {
                // re-open the step you land on; everything decided past the
                // cursor (pins, stashes, grabs, defers, ticks) unwinds in the
                // back-movement effect
                const prev = loadSteps[loadIdx - 1]
                if (prev?.kind === 'load')
                  for (const oid of prev.loadIds) {
                    const cid = objMeta.get(oid)?.contractId
                    if (cid) setPickedUp(cid, oid, pickupVisitKey(prev.nodeKey, prev.trip), false)
                  }
                else if (prev?.kind === 'drop') unmarkTurnIn(prev.lines.map((l) => l.objectiveId))
                setLoadIdx((i) => Math.max(0, i - 1))
              }}
              onExit={() => setLoading(false)}
              onRestart={() => {
                // starting over wipes every pickup, turn-in, placed pin, stash
                // and decision so the walk is a fresh start
                clearAllPickedUp()
                unmarkTurnIn(contracts.flatMap((c) => c.objectives.map((o) => o.id)))
                resetWalkDecisions()
                setLoadIdx(0)
              }}
            />
          </div>
        )}
        <div style={{ ...(portrait && loading ? { order: 1, flex: 'none', height: '42%', minHeight: 220 } : { flex: 1 }), minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div
          ref={wrap}
          style={{ position: 'relative', flex: 1, minHeight: portrait ? 170 : 320, border: `1px solid ${C.line}`, borderRadius: 6, overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 40%, #06090b, #000)' }}
        >
        {loading && (
          <Btn
            onClick={() => setShelfOpen((v) => !v)}
            title="Park Stor-All crates for personal storage"
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              zIndex: 4,
              border: `1px solid ${shelfOpen ? STOR_ORANGE : C.lineStrong}`,
              background: 'rgba(8,12,16,0.82)',
              color: shelfOpen ? STOR_ORANGE : C.dim,
              fontFamily: F.display,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.14em',
              padding: '6px 12px',
              cursor: 'pointer'
            }}
            hoverStyle={{ color: STOR_ORANGE, border: `1px solid ${STOR_ORANGE}` }}
          >
            STOR-ALL
          </Btn>
        )}
        {dropNotice && (
          <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 4, maxWidth: '86%', background: 'rgba(8,12,16,0.94)', border: `1px solid ${C.amber}`, borderRadius: 6, padding: '8px 14px', fontFamily: F.body, fontSize: 13.5, color: C.text }}>
            {dropNotice}
          </div>
        )}
        {loading && shelfOpen && (
          <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 4, display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(8,12,16,0.94)', border: `1px solid ${C.lineStrong}`, borderRadius: 6, padding: 10, maxWidth: 190 }}>
            <span style={{ fontFamily: F.display, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.16em', color: STOR_ORANGE }}>
              STOR-ALL
            </span>
            {[1, 2, 4, 8].map((size) => (
              <div
                key={size}
                onPointerDown={(e) => {
                  e.preventDefault()
                  spawnCrate(size)
                }}
                style={{ cursor: 'grab', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', border: `1px solid ${STOR_ORANGE}55`, borderRadius: 5, background: '#101216', fontFamily: F.body, fontSize: 13.5, color: C.text }}
              >
                <span style={{ width: 14, height: 14, flex: 'none', background: STOR_BODY, border: `2px solid ${STOR_ORANGE}`, borderRadius: 3 }} />
                {size} SCU
              </div>
            ))}
            <span style={{ fontFamily: F.body, fontSize: 11.5, color: C.dim }}>
              Drag onto the grid. Right-click a crate to remove it.
            </span>
          </div>
        )}
        {loading && (
          <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 4, pointerEvents: 'none', background: 'rgba(8,12,16,0.82)', border: `1px solid ${C.lineFaint}`, borderRadius: 6, padding: '8px 11px', fontFamily: F.mono, fontSize: 10.5, lineHeight: 1.7, color: C.dim, display: 'flex', flexDirection: 'column' }}>
            {[
              ['Drag', 'move a box'],
              ['R', 'rotate'],
              ['Ctrl click', 'select more'],
              ['Right click', 'remove a crate']
            ].map(([key, what]) => (
              <div key={key}>
                <b style={{ color: C.body, fontWeight: 600 }}>{key}</b> to {what}
              </div>
            ))}
          </div>
        )}
        {loading && (
          <Btn
            onClick={() => void updateSettings({ spaceDeliveryPiles: !spaceDeliveryPiles })}
            title="Leave a gap between cargo for different stops, when there's room"
            style={{
              position: 'absolute',
              bottom: 10,
              right: 10,
              zIndex: 4,
              border: `1px solid ${spaceDeliveryPiles ? C.acc : C.lineStrong}`,
              background: 'rgba(8,12,16,0.82)',
              color: spaceDeliveryPiles ? C.acc : C.dim,
              fontFamily: F.display,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.14em',
              padding: '6px 12px',
              cursor: 'pointer'
            }}
            hoverStyle={{ color: C.acc, border: `1px solid ${C.acc}` }}
          >
            SPACE PILES · {spaceDeliveryPiles ? 'ON' : 'OFF'}
          </Btn>
        )}
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
                  desc="We plan the load and walk you through it stop by stop. Drag boxes to rearrange."
                  onClick={startLoading}
                />
              ) : (
                <div style={{ textAlign: 'center', fontFamily: F.body, fontSize: 14, color: C.dim, background: 'rgba(8,12,16,0.9)', border: `1px solid ${C.lineStrong}`, borderRadius: 8, padding: '18px 22px' }}>
                  No route yet, fix the cargo on the Manifest then come back to load.
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
          {shownGrids.map((g) => {
            // spun/re-floored bays get a solid floor plate: it reads as the
            // surface cargo mounts to, and it eats clicks that would otherwise
            // pass through the open wireframe and grab a box behind it
            if (!g.rot && (g.floor ?? 'y-') === 'y-') return null
            const floor = g.floor ?? 'y-'
            const up = axOf(floor[0])
            const grow = floor[1] === '-' ? 1 : -1
            const size = sizeOf(g)
            const t = 0.12
            const args: [number, number, number] = [up === 0 ? t : g.w, up === 1 ? t : g.h, up === 2 ? t : g.l]
            const off = [0, 0, 0]
            off[up] = -grow * (size[up] / 2 - t / 2)
            return (
              <group
                key={`floor-${g.id}`}
                position={[center(g.x || 0, g.w, origin[0]), center(g.y || 0, g.h, origin[1]), center(g.z || 0, g.l, origin[2])]}
                rotation={bayRot(g)}
              >
                <mesh
                  position={[off[0], off[1], off[2]]}
                  receiveShadow
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onPointerMove={(e) => {
                    e.stopPropagation()
                    if (drag) handleDragMove(e.point.x + origin[0], e.point.z + origin[2], e.ray)
                  }}
                >
                  <boxGeometry args={args} />
                  <meshStandardMaterial color="#13536c" roughness={1} metalness={0} transparent opacity={0.94} />
                </mesh>
              </group>
            )
          })}
          <OrientationLabels frame={frame} half={shipHalf} shipCenter={shipCenter} />
          {loading && planFootprint.map((f) => {
            const g = gridById.get(f.gridId)
            if (!g) return null
            return (
              <group key={f.gridId} position={[center(g.x || 0, g.w, origin[0]), center(g.y || 0, g.h, origin[1]), center(g.z || 0, g.l, origin[2])]} rotation={bayRot(g)}>
                <mesh
                  raycast={() => null}
                  position={[
                    center((g.x || 0) + f.x, f.w, origin[0]) - center(g.x || 0, g.w, origin[0]),
                    center((g.y || 0) + f.y, f.h, origin[1]) - center(g.y || 0, g.h, origin[1]),
                    center((g.z || 0) + f.z, f.l, origin[2]) - center(g.z || 0, g.l, origin[2])
                  ]}
                >
                  <boxGeometry args={[f.w, f.h, f.l]} />
                  <meshBasicMaterial color={C.green} transparent opacity={0.05} depthWrite={false} />
                  <Edges color={C.green} />
                </mesh>
              </group>
            )
          })}
          {loading && offGridBay && (
            <>
              <GridShell grid={offGridBay} origin={origin} color={C.red} />
              {(() => {
                const size = Math.min(2.4, Math.max(1, offGridBay.w * 0.16))
                return (
                  <Text
                    font={sairaFont}
                    position={[
                      center(offGridBay.x, offGridBay.w, origin[0]),
                      center(offGridBay.y, offGridBay.h, origin[1]) - offGridBay.h / 2 + 0.02,
                      (offGridBay.z || 0) - origin[2] - size * 0.9
                    ]}
                    rotation={[-Math.PI / 2, 0, Math.PI]}
                    fontSize={size}
                    color={C.red}
                    anchorX="center"
                    anchorY="middle"
                    letterSpacing={0.14}
                    outlineWidth={size * 0.03}
                    outlineColor="#000"
                  >
                    OFF GRID
                  </Text>
                )
              })()}
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
            const mode = boxMode(pl.box.objectiveId)
            // this step's cargo and anything already aboard is yours to rearrange;
            // future-trip boxes stay put
            const mkey = mode === 'current' || mode === 'loaded' ? boxKey(pl.box) : undefined
            // ghost stands in while dragging
            if (mkey && dragKeys?.has(mkey)) return null
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
                blocked={blockedKeys.has(boxKey(pl.box))}
                onStart={(e) => {
                  if (mkey) startDrag(mkey, pl, g, e)
                }}
                onDragMove={drag ? handleDragMove : undefined}
                onHover={onHover}
                onLeave={() => setHover(null)}
              />
            )
          })}
          {crates.map((c) => {
            const g = gridById.get(c.gridId)
            if (!g || dragKeys?.has(c.id)) return null
            return (
              <StorAllBox
                key={c.id}
                crate={c}
                grid={g}
                origin={origin}
                onStart={(e) => startCrateDrag(c, g, e)}
                onRemove={() => removeStorAll(c.id)}
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
                handleDragMove(e.point.x + origin[0], e.point.z + origin[2], e.ray)
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
              const gg = ghost ? gridById.get(ghost.gridId) : undefined
              // on a spun or re-floored bay the ground projection parallaxes away
              // from the cursor, so the held box rides the ghost spot instead
              if (ghost && gg && !ghost.members && (gg.rot || (gg.floor ?? 'y-') !== 'y-')) {
                const floor = gg.floor ?? 'y-'
                const up = axOf(floor[0])
                const grow = floor[1] === '-' ? 1 : -1
                const lift = [0, 0, 0]
                lift[up] = grow * 0.35
                const bcx = center(gg.x || 0, gg.w, origin[0])
                const bcy = center(gg.y || 0, gg.h, origin[1])
                const bcz = center(gg.z || 0, gg.l, origin[2])
                return (
                  <group position={[bcx, bcy, bcz]} rotation={bayRot(gg)}>
                    <mesh
                      raycast={() => null}
                      position={[
                        center((gg.x || 0) + ghost.x, ghost.w, origin[0]) - bcx + lift[0],
                        center((gg.y || 0) + ghost.y, ghost.h, origin[1]) - bcy + lift[1],
                        center((gg.z || 0) + ghost.z, ghost.l, origin[2]) - bcz + lift[2]
                      ]}
                    >
                      <boxGeometry args={[ghost.w - GAP, ghost.h - GAP, ghost.l - GAP]} />
                      <meshStandardMaterial color={drag.box.color} roughness={0.6} metalness={0} emissive={C.green} emissiveIntensity={0.1} />
                      <Edges color={C.green} />
                    </mesh>
                  </group>
                )
              }
              const held: { key: string; box: PackBox; dx: number; dz: number; w: number; l: number; h: number }[] =
                group ?? [{ key: drag.key, box: drag.box, dx: 0, dz: 0, w: dragRot ? dims.l : dims.w, l: dragRot ? dims.w : dims.l, h: dims.h }]
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
  canStash,
  blockKind,
  onDecide,
  onStashOffGrid,
  onComeBack,
  grab,
  onGrab,
  grabbedHere,
  onUngrab,
  deferred,
  onUndoDefer,
  capacity,
  reserved,
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
  canStash: boolean
  blockKind: 'overload' | 'digout' | null
  onDecide: () => void
  onStashOffGrid: (boxes: PackBox[]) => void
  onComeBack: (objectiveIds: string[]) => void
  grab: { scu: number; count: number; stepNo: number } | null
  onGrab: () => void
  grabbedHere: string[]
  onUngrab: (ids: string[]) => void
  deferred: { id: string; label: string }[]
  onUndoDefer: (id: string) => void
  capacity: number
  reserved: number
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
  const blockAdvance = blockKind != null
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
          STEP {steps[0]?.start ? idx : idx + 1} / {steps[0]?.start ? total - 1 : total}
        </span>
        <span style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600, color: C.text, textShadow: GLOW }}>
          {step.code && step.code.toLowerCase() !== step.label.toLowerCase() ? `${step.code} · ` : ''}{step.label}
        </span>
      </div>

      <div style={{ padding: '0 16px 10px', flex: 'none' }}>
        <LoadBar current={aboard} peak={peak} capacity={capacity} reserved={reserved} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 16px 10px', display: 'flex', flexDirection: 'column' }}>
        {here.map((s, li) => {
          const gi = visitStart + li
          const isCurrent = gi === idx
          const isPast = gi < idx
          const load = s.kind === 'load'
          if (s.start)
            return (
              <div key="start" ref={isCurrent ? currentRef : undefined} style={{ borderLeft: `3px solid ${C.acc}`, padding: '9px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: C.acc, boxShadow: isCurrent ? GLOW : 'none', flex: 'none' }} />
                  <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.14em', color: isCurrent ? C.text : C.dim }}>
                    EMPTY HOLD
                  </span>
                  {isCurrent && (
                    <span style={{ marginLeft: 'auto', fontFamily: F.display, fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: C.acc }}>● NOW</span>
                  )}
                </div>
                <div style={{ fontFamily: F.body, fontSize: 13, color: C.dim }}>
                  Set up your hold, then head out.
                </div>
              </div>
            )
          const accent = (load ? objColors.get(s.lines[0]?.objectiveId) : C.acc) ?? C.green
          return (
            <div
              key={`${s.kind}-${s.boundFor}-${gi}`}
              ref={isCurrent ? currentRef : undefined}
              style={{
                borderLeft: `3px solid ${accent}`,
                borderTop: li === 0 ? 'none' : `1px solid ${C.lineFaint}`,
                background: isCurrent ? 'rgba(255,255,255,0.045)' : 'transparent',
                opacity: isPast ? 0.5 : 1,
                padding: '9px 12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: accent, boxShadow: isCurrent ? GLOW : 'none', flex: 'none' }} />
                <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.14em', color: isCurrent ? C.text : C.dim }}>
                  {load ? (
                    <>LOAD → Going to <b style={{ fontWeight: 700 }}>{destLabelOf(s.boundFor)}</b></>
                  ) : (
                    'DELIVER'
                  )}
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
                  destLabel={destLabelOf(s.boundFor)}
                  loadIds={s.loadIds}
                  canStash={canStash}
                  onDecide={onDecide}
                  onStashOffGrid={onStashOffGrid}
                  onComeBack={onComeBack}
                />
              )}
            </div>
          )
        })}
      </div>

      {isLoad && grab && (
        <div style={{ margin: '0 16px', padding: '10px 0 8px', borderTop: `1px solid ${C.lineFaint}`, flex: 'none' }}>
          <div style={{ fontFamily: F.display, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.12em', color: C.amber }}>
            ALSO HERE · SKIP THE RETURN
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.body, margin: '4px 0 8px' }}>
            {grab.count} boxes / {grab.scu} SCU planned for a return at step {grab.stepNo}; grab them now to drop that stop.
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
        <div style={{ margin: '0 16px', padding: '9px 0 8px', borderTop: `1px solid ${C.lineFaint}`, flex: 'none' }}>
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
      {blockKind && (
        <div style={{ margin: '0 16px', padding: '9px 11px', border: `1px solid ${C.amber}`, borderRadius: 5, background: 'rgba(201,176,126,0.08)', flex: 'none' }}>
          <span style={{ fontFamily: F.body, fontSize: 12, lineHeight: 1.5, color: C.amber }}>
            {blockKind === 'overload'
              ? `This pickup won't fit as-is. ${canStash ? 'Stash the overflow off grid or come back for it' : 'Come back for it on a later trip'} before you move on.`
              : "You'll have to dig cargo out to unload here. Load it and dig, or come back for it, before you move on."}
          </span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, padding: '10px 16px 14px', flex: 'none', borderTop: `1px solid ${C.lineFaint}` }}>
        {arrowBtn('‹', onBack, idx === 0)}
        {isLoad ? (
          <Btn
            onClick={onLoaded}
            disabled={blockAdvance}
            title={blockAdvance ? 'Make the call above first' : undefined}
            style={{ flex: 1, border: `1px solid ${blockAdvance ? C.lineStrong : C.acc}`, background: blockAdvance ? 'transparent' : C.accFillStrong, color: blockAdvance ? C.ghost : C.text, textShadow: blockAdvance ? 'none' : GLOW, fontFamily: F.display, fontSize: 13, fontWeight: 600, letterSpacing: '0.16em', padding: 11, cursor: blockAdvance ? 'default' : 'pointer' }}
            hoverStyle={blockAdvance ? {} : { background: 'rgba(255,210,30,0.26)' }}
          >
            {step?.start ? 'HEAD OUT' : blockKind === 'overload' ? "WON'T FIT · DECIDE ABOVE" : blockKind === 'digout' ? 'DIG-OUT · DECIDE ABOVE' : 'LOADED · NEXT'}
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
          sub="you can change this until the contract completes"
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
            Find the contract with <b style={{ color: C.text }}>{line.tell}</b>
          </span>
        ) : (
          <span style={{ fontFamily: F.body, fontSize: 13, color: C.amber }}>⚠ No standout box, match the whole set</span>
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
        <div style={{ fontFamily: F.body, fontSize: 12.5, color: C.ghost, marginTop: 3 }}>Not turned in yet</div>
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
        drop this trip&apos;s {line.scu} SCU (trip {line.tripPos}/{line.tripTotal}) · {rest} SCU rides a later trip
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
    <div style={{ marginTop: 12, paddingTop: 13, borderTop: `1px solid ${C.line}` }}>
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
      <div style={{ marginTop: 8, fontFamily: F.mono, fontSize: 12, color: C.amber }}>
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
  destLabel,
  loadIds,
  canStash,
  onDecide,
  onStashOffGrid,
  onComeBack
}: {
  decision: BucketDecision
  destLabel: string
  loadIds: string[]
  canStash: boolean
  onDecide: () => void
  onStashOffGrid: (boxes: PackBox[]) => void
  onComeBack: (objectiveIds: string[]) => void
}): React.ReactElement | null {
  const [choice, setChoice] = useState<string | null>(null)
  if (decision.kind === 'none') return null

  const dig = decision.kind === 'digout'
  const offScu = decision.overloadBoxes.reduce((a, b) => a + b.size, 0)
  const offBreakdown = listBreakdown(decision.overloadBoxes.map((b) => b.size))
  const digCount = decision.digBoxes.length
  const digBreakdown = listBreakdown(decision.digBoxes.map((b) => b.size))

  const pick = (id: string, run: () => void): void => {
    setChoice(id)
    run()
    onDecide()
  }

  const options = dig
    ? [
        { id: 'load', title: 'Load it now', desc: `Set aside ${digCount} boxes to dig out earlier stops.`, run: () => {} },
        { id: 'come', title: 'Come back for it', desc: 'Grab it on a later pass.', run: () => onComeBack(loadIds) }
      ]
    : [
        // no stash on ships with no off-grid: the boxes would just vanish
        ...(canStash
          ? [{ id: 'stash', title: 'Stash the overflow off-grid', desc: `${offBreakdown} rides off grid, the rest loads normally.`, run: () => onStashOffGrid(decision.overloadBoxes) }]
          : []),
        { id: 'come', title: `Come back for ${destLabel}'s load`, desc: 'Leave the whole pickup for a later trip.', run: () => onComeBack(loadIds) }
      ]

  const confirmCopy: Record<string, string> = {
    load: `Loading now, ${digCount} boxes set aside to dig out earlier stops.`,
    come: dig ? 'Skipped for a later pass.' : 'Whole pickup left for a later trip.',
    stash: `Stashed off grid: ${offBreakdown}.`
  }

  const accent = dig ? '#a99cd0' : '#c9b07e'

  return (
    <div style={{ marginTop: 12, paddingTop: 13, borderTop: `1px solid ${C.line}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 9 }}>
        <span style={{ fontFamily: F.display, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: accent }}>
          {dig ? 'DIG-OUT' : "WON'T FIT"}
        </span>
        <span style={{ fontFamily: F.body, fontSize: 11.5, color: C.ghost }}>Going to <b style={{ fontWeight: 700, color: C.dim }}>{destLabel}</b></span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
        {dig ? <span style={{ color: accent, fontSize: 18, lineHeight: 1, flex: 'none' }}>↺</span> : <OffGridGlyph />}
        <span style={{ fontFamily: F.display, fontSize: 15, fontWeight: 600, letterSpacing: '0.02em', color: C.text }}>
          {dig ? `Set aside ${digCount} boxes · ${digBreakdown}` : `${offBreakdown} · ${fmt(offScu)} SCU won't fit`}
        </span>
      </div>
      <div style={{ fontFamily: F.body, fontSize: 12.5, lineHeight: 1.5, color: '#a8b0b3', marginBottom: 13 }}>
        {dig
          ? 'The plan says these sit on cargo you deliver sooner. Load and dig them out, or come back later?'
          : canStash
            ? "The plan says these boxes won't fit on grid. Load them off grid or come back later?"
            : "The plan says these won't fit, and this ship can't carry off grid. Come back later?"}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {options.map((o) => (
          <DecisionOption key={o.id} title={o.title} desc={o.desc} selected={choice === o.id} onClick={() => pick(o.id, o.run)} />
        ))}
      </div>

      {choice && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11 }}>
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
        border: `1px solid ${selected ? C.acc : C.lineStrong}`,
        borderRadius: 5,
        background: selected ? 'rgba(255,210,30,0.08)' : 'transparent',
        padding: '11px 13px',
        cursor: 'pointer',
        width: '100%'
      }}
      hoverStyle={selected ? {} : { border: `1px solid ${C.acc}`, background: 'rgba(255,255,255,0.03)' }}
    >
      <span style={{ flex: 'none', width: 16, height: 16, marginTop: 2, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: selected ? C.acc : 'transparent', border: selected ? 'none' : `1.5px solid rgba(255,255,255,0.3)` }}>
        {selected && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: F.display, fontSize: 14, fontWeight: 600, letterSpacing: '0.02em', color: selected ? C.acc : C.text, textShadow: selected ? GLOW : 'none' }}>
          {title}
        </span>
        <span style={{ display: 'block', fontFamily: F.body, fontSize: 12, color: selected ? '#a8b0b3' : '#98a0a3', marginTop: 2 }}>
          {desc}
        </span>
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
