// x width, y up, z length, bay-local cells.
// a delivery is a wall, ordered exit-inward by drop.

import type { CargoGrid } from './cargoGrids'
import { BOX_DIMS, type BoxDims } from './boxGeometry'

export interface PackBox {
  id: string
  size: number
  color: string
  dest: string
  commodity?: string
  /** delivery order, 0 = nearest exit. */
  stopIdx: number
  objectiveId?: string
  /** keeps shared boxes adjacent in a wall. */
  bucketId?: string
  slot?: number
  /** confirmed aboard, an immovable anchor. */
  loaded?: boolean
}

export interface Placement {
  box: PackBox
  gridId: string
  x: number
  y: number
  z: number
  w: number
  l: number
  h: number
  rotated: boolean
}

export interface GridFill {
  id: string
  name: string
  w: number
  l: number
  h: number
  capacity: number
  used: number
}

/** a box needing a shuffle, and why. */
export interface PeelDebt {
  boxId: string
  reason: 'pin-x' | 'pin-z' | 'path'
}

export interface PackResult {
  placements: Placement[]
  unplaced: PackBox[]
  grids: GridFill[]
  capacity: number
  placedScu: number
  fits: boolean
  /** kept for callers, always false. */
  squeezed: boolean
  /** all boxes extract without a shuffle. */
  peelOk: boolean
  peelDebt: PeelDebt[]
}

export interface PackOpts {
  exitAware?: boolean
  peel?: boolean
  cluster?: boolean
}

export interface Occupied {
  gridId: string
  x: number
  y: number
  z: number
  w: number
  l: number
  h: number
  stopIdx: number
}

export interface LoadEvent {
  load: PackBox[]
  drop: string[]
}

const DEFAULT_EXIT = { axis: 'z' as const, dir: -1 as const }

interface Bay {
  grid: CargoGrid
  occ: Uint8Array
  owner: Int16Array // stop per cell, -1 empty
  axis: 'x' | 'z'
  dir: -1 | 1
  /** wall on high side of cross axis. */
  wallHigh: boolean
  used: number
  /** depth window this bay's wall may use. */
  fmin: number
  fmax: number
}

const cellIdx = (g: CargoGrid, x: number, y: number, z: number): number =>
  x + z * g.w + y * (g.w * g.l)

// wall-side fills first, low when unmarked.
function wallIsHigh(grid: CargoGrid, axis: 'x' | 'z'): boolean {
  const f = grid.faces
  if (!f) return false
  const hi = axis === 'z' ? f['x+'] : f['z+']
  const lo = axis === 'z' ? f['x-'] : f['z-']
  return hi === 'wall' || lo === 'aisle'
}

function makeBay(grid: CargoGrid): Bay {
  const exit = grid.exit ?? DEFAULT_EXIT
  return {
    grid,
    occ: new Uint8Array(grid.w * grid.l * grid.h),
    owner: new Int16Array(grid.w * grid.l * grid.h).fill(-1),
    axis: exit.axis,
    dir: exit.dir,
    wallHigh: wallIsHigh(grid, exit.axis),
    used: 0,
    fmin: 0,
    fmax: Infinity
  }
}

const loadable = (grids: CargoGrid[]): CargoGrid[] => grids.filter((g) => g.autoLoad !== false)

// far wall, for dir=+1.
function maxAxisOf(grids: CargoGrid[]): number {
  let m = 0
  for (const g of grids) m = Math.max(m, (g.exit?.axis ?? 'z') === 'z' ? g.z + g.l : g.x + g.w)
  return m
}

// exit to nearest edge, lower earlier.
function depthOf(b: Bay, lx: number, lz: number, fw: number, fl: number, maxAxis: number): number {
  if (b.axis === 'z') {
    const near = b.grid.z + lz
    return b.dir === -1 ? near : maxAxis - (near + fl)
  }
  const near = b.grid.x + lx
  return b.dir === -1 ? near : maxAxis - (near + fw)
}

// near-wall edge, lower = tighter to wall.
function crossOf(b: Bay, lx: number, lz: number, fw: number, fl: number): number {
  const g = b.grid
  if (b.axis === 'z') return b.wallHigh ? g.x + g.w - (lx + fw) : g.x + lx
  return b.wallHigh ? g.z + g.l - (lz + fl) : g.z + lz
}

const spanOf = (b: Bay, fw: number, fl: number): number => (b.axis === 'z' ? fl : fw)

function free(b: Bay, x: number, y: number, z: number, fw: number, fl: number, fh: number): boolean {
  const g = b.grid
  if (x < 0 || y < 0 || z < 0 || x + fw > g.w || z + fl > g.l || y + fh > g.h) return false
  for (let dy = 0; dy < fh; dy++)
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) if (b.occ[cellIdx(g, x + dx, y + dy, z + dz)]) return false
  return true
}

// lowest rest y, ownerOk gates support.
function restY(
  b: Bay,
  x: number,
  z: number,
  fw: number,
  fl: number,
  fh: number,
  ownerOk: (owner: number) => boolean
): number {
  const g = b.grid
  for (let y = 0; y + fh <= g.h; y++) {
    if (!free(b, x, y, z, fw, fl, fh)) continue
    if (y === 0) return 0
    let ok = true
    for (let dz = 0; dz < fl && ok; dz++)
      for (let dx = 0; dx < fw && ok; dx++) {
        const i = cellIdx(g, x + dx, y - 1, z + dz)
        if (!b.occ[i] || !ownerOk(b.owner[i])) ok = false
      }
    if (ok) return y
  }
  return -1
}

function fill(b: Bay, x: number, y: number, z: number, fw: number, fl: number, fh: number, stop: number): void {
  const g = b.grid
  for (let dy = 0; dy < fh; dy++)
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) {
        const i = cellIdx(g, x + dx, y + dy, z + dz)
        b.occ[i] = 1
        b.owner[i] = stop
      }
  b.used += fw * fl * fh
}

const orientsOf = (d: BoxDims): Array<[number, number, boolean]> =>
  d.w === d.l ? [[d.w, d.l, false]] : [[d.w, d.l, false], [d.l, d.w, true]]

interface Spot {
  bay: Bay
  x: number
  y: number
  z: number
  fw: number
  fl: number
  fh: number
  rotated: boolean
  near: number
  far: number
  cross: number
}

// rank: home > stack > shallow > thin > wall > low.
function bestSpot(bays: Bay[], dims: BoxDims, size: number, stop: number, maxAxis: number, home: Bay | null): Spot | null {
  let best: (Spot & { cross: number; home: boolean; floor: number }) | null = null
  const ownerOk = (o: number): boolean => o === stop
  const beats = (h: boolean, floor: number, near: number, far: number, cross: number, y: number): boolean => {
    if (!best) return true
    if (h !== best.home) return h
    if (floor !== best.floor) return floor < best.floor
    // lowest layer first, smalls sit flat.
    if (y !== best.y) return y < best.y
    if (near !== best.near) return near < best.near
    if (far !== best.far) return far < best.far
    return cross < best.cross
  }
  for (const b of bays) {
    if (b.grid.maxSize && size > b.grid.maxSize) continue
    const isHome = !home || b === home
    if (best && best.home && !isHome) continue
    const g = b.grid
    for (const [fw, fl, rotated] of orientsOf(dims)) {
      for (let x = 0; x + fw <= g.w; x++)
        for (let z = 0; z + fl <= g.l; z++) {
          const near = depthOf(b, x, z, fw, fl, maxAxis)
          const far = near + spanOf(b, fw, fl)
          if (near < b.fmin || far > b.fmax) continue
          const y = restY(b, x, z, fw, fl, dims.h, ownerOk)
          if (y < 0) continue
          const cross = crossOf(b, x, z, fw, fl)
          // new floor claimed, 0 when stacking.
          const floor = y === 0 ? fw * fl : 0
          if (beats(isHome, floor, near, far, cross, y))
            best = { bay: b, x, y, z, fw, fl, fh: dims.h, rotated, near, far, cross, home: isHome, floor }
        }
    }
  }
  return best
}

// bay's shallowest cell, its dist from exit.
function bayFront(b: Bay, maxAxis: number): number {
  const g = b.grid
  return Math.min(depthOf(b, 0, 0, 1, 1, maxAxis), depthOf(b, g.w - 1, g.l - 1, 1, 1, maxAxis))
}

// where this bay's open space starts.
const openFront = (b: Bay, maxAxis: number): number => Math.max(b.fmin, bayFront(b, maxAxis))

interface WallResult {
  placements: Placement[]
  unplaced: PackBox[]
  /** depth band per bay, far feeds next wall. */
  bands: Map<string, { near: number; far: number }>
}

// lay a delivery's boxes as a wall.
function placeWall(bays: Bay[], boxes: PackBox[], stop: number, maxAxis: number, order: (a: PackBox, b: PackBox) => number): WallResult {
  const placements: Placement[] = []
  const unplaced: PackBox[] = []
  const bands = new Map<string, { near: number; far: number }>()
  const maxBox = boxes.reduce((m, b) => Math.max(m, b.size), 0)
  const home =
    bays
      .filter((b) => (!b.grid.maxSize || maxBox <= b.grid.maxSize) && b.fmin <= b.fmax)
      .sort((a, b) => openFront(a, maxAxis) - openFront(b, maxAxis) || a.grid.x - b.grid.x || a.grid.z - b.grid.z)[0] ?? null
  for (const box of [...boxes].sort(order)) {
    const dims = BOX_DIMS[box.size]
    if (!dims) {
      unplaced.push(box)
      continue
    }
    const s = bestSpot(bays, dims, box.size, stop, maxAxis, home)
    if (!s) {
      unplaced.push(box)
      continue
    }
    fill(s.bay, s.x, s.y, s.z, s.fw, s.fl, s.fh, stop)
    placements.push({ box, gridId: s.bay.grid.id, x: s.x, y: s.y, z: s.z, w: s.fw, l: s.fl, h: s.fh, rotated: s.rotated })
    const band = bands.get(s.bay.grid.id) ?? { near: Infinity, far: 0 }
    band.near = Math.min(band.near, s.near)
    band.far = Math.max(band.far, s.far)
    bands.set(s.bay.grid.id, band)
  }
  return { placements, unplaced, bands }
}

// biggest first, ties keep buckets adjacent.
const wallOrder = (a: PackBox, b: PackBox): number =>
  b.size - a.size || (a.bucketId ?? '').localeCompare(b.bucketId ?? '')

interface Pass {
  placements: Placement[]
  unplaced: PackBox[]
}

// static plan, all deliveries aboard at once.
function planAll(grids: CargoGrid[], boxes: PackBox[], seed: Occupied[] = []): Pass {
  const bays = loadable(grids).map(makeBay)
  const maxAxis = maxAxisOf(grids)
  const byId = new Map(bays.map((b) => [b.grid.id, b]))
  for (const o of seed) {
    const b = byId.get(o.gridId)
    if (b) fill(b, o.x, o.y, o.z, o.w, o.l, o.h, o.stopIdx)
  }
  const byStop = new Map<number, PackBox[]>()
  for (const b of boxes) (byStop.get(b.stopIdx) ?? byStop.set(b.stopIdx, []).get(b.stopIdx)!).push(b)
  const placements: Placement[] = []
  const unplaced: PackBox[] = []
  for (const stop of [...byStop.keys()].sort((a, b) => a - b)) {
    const w = placeWall(bays, byStop.get(stop)!, stop, maxAxis, wallOrder)
    placements.push(...w.placements)
    unplaced.push(...w.unplaced)
    for (const [id, band] of w.bands) {
      const bay = byId.get(id)
      if (bay) bay.fmin = Math.max(bay.fmin, band.far)
    }
  }
  return { placements, unplaced }
}

export function packCargo(grids: CargoGrid[], boxes: PackBox[], opts: PackOpts = {}): PackResult {
  const ld = loadable(grids)
  const { placements, unplaced } = planAll(grids, boxes)

  let peelOk = true
  let peelDebt: PeelDebt[] = []
  if (opts.peel) {
    const proof = provePeel(ld, placements)
    peelOk = proof.peelOk
    peelDebt = proof.peelDebt
  }

  const usedBy = new Map<string, number>()
  for (const p of placements) usedBy.set(p.gridId, (usedBy.get(p.gridId) ?? 0) + p.w * p.l * p.h)
  const capacity = ld.reduce((a, g) => a + g.w * g.l * g.h, 0)
  return {
    placements,
    unplaced,
    grids: ld.map((g) => ({
      id: g.id,
      name: g.name,
      w: g.w,
      l: g.l,
      h: g.h,
      capacity: g.w * g.l * g.h,
      used: usedBy.get(g.id) ?? 0
    })),
    capacity,
    placedScu: placements.reduce((a, p) => a + p.box.size, 0),
    fits: unplaced.length === 0,
    squeezed: false,
    peelOk,
    peelDebt
  }
}

// pack around cargo aboard, never moving it.
export function packInto(grids: CargoGrid[], occupied: Occupied[], boxes: PackBox[], _exitAware = false): Pass {
  void _exitAware
  return planAll(grids, boxes, occupied)
}

// flag boxes a later drop blocks.
export function provePeel(grids: CargoGrid[], placements: Placement[]): { peelOk: boolean; peelDebt: PeelDebt[] } {
  const debt: PeelDebt[] = []
  const byGrid = new Map<string, Placement[]>()
  for (const p of placements) (byGrid.get(p.gridId) ?? byGrid.set(p.gridId, []).get(p.gridId)!).push(p)

  for (const g of grids) {
    const ps = byGrid.get(g.id)
    if (!ps) continue
    const exit = g.exit ?? DEFAULT_EXIT
    const onZ = exit.axis === 'z'
    const depth = (p: Placement): number =>
      onZ ? (exit.dir === -1 ? p.z : g.l - (p.z + p.l)) : exit.dir === -1 ? p.x : g.w - (p.x + p.w)
    for (const p of ps) {
      const pd = depth(p)
      const blocked = ps.some((q) => {
        if (q === p || q.box.stopIdx <= p.box.stopIdx || depth(q) >= pd) return false
        const yOver = p.y < q.y + q.h && q.y < p.y + p.h
        const cross = onZ ? p.x < q.x + q.w && q.x < p.x + p.w : p.z < q.z + q.l && q.z < p.z + p.l
        return yOver && cross
      })
      if (blocked) debt.push({ boxId: p.box.id, reason: 'path' })
    }
  }
  return { peelOk: debt.length === 0, peelDebt: debt }
}
