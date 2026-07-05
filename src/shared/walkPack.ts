// The loading-walk packer. Lays the run out into tight per-destination sections,
// biggest box first so it anchors the floor, delivery order front to back, each
// stop its own block. The walk then reveals boxes as they board and hides them as
// they leave; homes are fixed so the stacks look settled the whole way through.
//
// Two rules keep it honest during the walk:
//  - a box only rests on its OWN destination's cargo, so each stop is a clean tower
//    and delivering one never pulls the floor from another.
//  - a box never rests on cargo that boards later than it does, so nothing you
//    haven't loaded yet is holding something up (no floaters mid-load).
//
// Its own module on purpose, clear of the exit-face helpers packer.ts grew.

import type { CargoGrid } from './cargoGrids'
import { BOX_DIMS } from './boxGeometry'
import type { LoadEvent, Placement, PackBox } from './packer'
import type { LoadSnap } from './loadout'

const FIXTURE = -2 // owns crate cells; cargo never stacks on it

interface Bay {
  grid: CargoGrid
  occ: Uint8Array
  owner: Int16Array
  /** which stop owns each depth slice; a slice holds one destination only. */
  slice: Int16Array
  /** scu of the box occupying each cell, so a box can seek a strictly bigger one to sit on. */
  size: Int16Array
  /** stacks hug the high-x wall and build toward the low-x aisle. */
  wallHigh: boolean
  used: number
}

const idx = (g: CargoGrid, x: number, y: number, z: number): number => x + z * g.w + y * (g.w * g.l)

// which x side is the wall to build off of. Aisle marks the open side, so we hug
// the opposite. Default: low-x wall.
function wallHigh(grid: CargoGrid): boolean {
  const f = grid.faces
  if (!f) return false
  return f['x+'] === 'wall' || f['x-'] === 'aisle'
}

function makeBay(grid: CargoGrid): Bay {
  const n = grid.w * grid.l * grid.h
  return { grid, occ: new Uint8Array(n), owner: new Int16Array(n).fill(-1), slice: new Int16Array(grid.l).fill(-1), size: new Int16Array(n), wallHigh: wallHigh(grid), used: 0 }
}

function canPlace(s: Bay, x: number, y: number, z: number, fw: number, fl: number, fh: number, stop: number): boolean {
  const g = s.grid
  if (x + fw > g.w || z + fl > g.l || y + fh > g.h) return false
  // a depth slice belongs to one destination, so stops never share a footprint
  for (let dz = 0; dz < fl; dz++) if (s.slice[z + dz] !== -1 && s.slice[z + dz] !== stop) return false
  for (let dy = 0; dy < fh; dy++)
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) if (s.occ[idx(g, x + dx, y + dy, z + dz)]) return false
  // floor, or resting fully on this stop's own cargo, so each stop is a clean tower
  if (y > 0) {
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) {
        const b = idx(g, x + dx, y - 1, z + dz)
        if (!s.occ[b] || s.owner[b] !== stop) return false
      }
  }
  return true
}

function fill(s: Bay, p: Placement, owner: number): void {
  const g = s.grid
  for (let dy = 0; dy < p.h; dy++)
    for (let dz = 0; dz < p.l; dz++)
      for (let dx = 0; dx < p.w; dx++) {
        const i = idx(g, p.x + dx, p.y + dy, p.z + dz)
        if (i < 0 || i >= s.occ.length) continue
        s.occ[i] = 1
        s.owner[i] = owner
        s.size[i] = p.box.size
      }
  // crates (fixtures) sit in a slice without owning it, so cargo can pack beside them
  if (owner >= 0) for (let dz = 0; dz < p.l; dz++) if (p.z + dz < g.l) s.slice[p.z + dz] = owner
  s.used += p.w * p.l * p.h
}

type Spot = { x: number; y: number; z: number; fw: number; fl: number }

// First fit for one orientation, scanned z (front) then x (from the wall toward
// the aisle) then y, so each column stacks all the way UP before the next starts
// across.
function firstFit(s: Bay, fw: number, fl: number, h: number, minZ: number, stop: number): Spot | null {
  const g = s.grid
  for (let z = Math.max(0, minZ); z + fl <= g.l; z++)
    for (let xi = 0; xi < g.w; xi++) {
      const x = s.wallHigh ? g.w - 1 - xi : xi
      for (let y = 0; y + h <= g.h; y++) if (canPlace(s, x, y, z, fw, fl, h, stop)) return { x, y, z, fw, fl }
    }
  return null
}

// Every cell directly under this footprint is a box strictly bigger than mine, so
// a box only rides on top of a genuinely larger one, never towers on its own size.
function supportBigger(s: Bay, x: number, y: number, z: number, fw: number, fl: number, mySize: number): boolean {
  const g = s.grid
  for (let dz = 0; dz < fl; dz++)
    for (let dx = 0; dx < fw; dx++) if (s.size[idx(g, x + dx, y - 1, z + dz)] <= mySize) return false
  return true
}

// Fill the lowest layer of gaps across the block, on top of bigger boxes, before
// stacking any higher, so tops stay flat for a later merge to slide onto.
function firstFitOnTop(s: Bay, fw: number, fl: number, h: number, minZ: number, stop: number, maxZ: number, mySize: number): Spot | null {
  const g = s.grid
  const lim = Math.min(g.l, maxZ)
  for (let y = 1; y + h <= g.h; y++)
    for (let z = Math.max(0, minZ); z + fl <= lim; z++)
      for (let xi = 0; xi < g.w; xi++) {
        const x = s.wallHigh ? g.w - 1 - xi : xi
        if (canPlace(s, x, y, z, fw, fl, h, stop) && supportBigger(s, x, y, z, fw, fl, mySize)) return { x, y, z, fw, fl }
      }
  return null
}

// Same scan, but no deeper than maxZ, so a filler stays inside the block already built.
function firstFitBounded(s: Bay, fw: number, fl: number, h: number, minZ: number, stop: number, maxZ: number): Spot | null {
  const g = s.grid
  const lim = Math.min(g.l, maxZ)
  for (let z = Math.max(0, minZ); z + fl <= lim; z++)
    for (let xi = 0; xi < g.w; xi++) {
      const x = s.wallHigh ? g.w - 1 - xi : xi
      for (let y = 0; y + h <= g.h; y++) if (canPlace(s, x, y, z, fw, fl, h, stop)) return { x, y, z, fw, fl }
    }
  return null
}

// Is the wall side between this deep box and the wall packed solid to the box's
// full depth, floor to ceiling? False when the box sits right against the wall.
function aisleFlush(s: Bay, spot: { x: number; z: number; fw: number; fl: number }, stop: number): boolean {
  const g = s.grid
  const from = s.wallHigh ? spot.x + spot.fw : 0
  const to = s.wallHigh ? g.w : spot.x
  if (from >= to) return false
  for (let x = from; x < to; x++)
    for (let z = spot.z; z < spot.z + spot.fl; z++)
      for (let y = 0; y < g.h; y++) {
        const i = idx(g, x, y, z)
        if (!s.occ[i] || s.owner[i] !== stop) return false
      }
  return true
}

// A stop packs its wall side solid — turning boxes across the bay and stacking
// them tall — to a box's full depth before it ever drops one into the leftover
// aisle strip, so the block builds front-to-back on the wall first and the aisle
// only fills once it sits flush against it. Square boxes never turn.
function findSpot(
  s: Bay,
  w: number,
  l: number,
  h: number,
  minZ: number,
  stop: number,
  size: number
): { x: number; y: number; z: number; fw: number; fl: number; rotated: boolean } | null {
  const g = s.grid
  let blockZ = 0
  for (let z = 0; z < g.l; z++) if (s.slice[z] === stop) blockZ = z + 1

  // a box sits on top of a strictly bigger one, filling its surface flat, before floor
  const onTop = firstFitOnTop(s, w, l, h, minZ, stop, blockZ > 0 ? blockZ : g.l, size)
  if (onTop) return { ...onTop, rotated: false }
  // a small filler stays inside the block rather than opening fresh floor
  if (w * l <= 4 && blockZ > 0) {
    const inside = firstFitBounded(s, w, l, h, minZ, stop, blockZ)
    if (inside) return { ...inside, rotated: false }
  }

  if (w === l) { const sq = firstFit(s, w, l, h, minZ, stop); return sq ? { ...sq, rotated: false } : null }

  const flat = firstFit(s, l, w, h, minZ, stop)   // turned across the bay: wide, shallow
  const narrow = firstFit(s, w, l, h, minZ, stop) // long into the bay: deep
  if (narrow && aisleFlush(s, narrow, stop)) return { ...narrow, rotated: false }
  if (flat) return { ...flat, rotated: true }
  return narrow ? { ...narrow, rotated: false } : null
}

export interface RunOpts {
  gap?: number
  pins?: ReadonlyMap<string, Placement>
  fixtures?: ReadonlyMap<string, Placement>
}

// One packing pass: each destination its own front-to-back section, biggest box
// first so it anchors the floor. Every box aboard at once.
export function packRun(grids: CargoGrid[], boxes: PackBox[], opts: RunOpts = {}): { homes: Map<string, Placement>; unplaced: PackBox[] } {
  const gap = opts.gap ?? 0
  const bays = grids.filter((g) => g.autoLoad !== false).map(makeBay)
  const byId = new Map(bays.map((b) => [b.grid.id, b]))

  if (opts.fixtures) for (const f of opts.fixtures.values()) { const b = byId.get(f.gridId); if (b) fill(b, f, FIXTURE) }

  const giOf = (gridId: string): number => bays.findIndex((b) => b.grid.id === gridId)
  const homes = new Map<string, Placement>()

  // Seat every locked box first and claim its slices, so no matter which
  // destination each pin belongs to, the packed cargo lands clear of it.
  const pinnedIds = new Set<string>()
  if (opts.pins)
    for (const [id, p] of opts.pins) {
      const b = byId.get(p.gridId)
      if (!b) continue
      fill(b, p, p.box.stopIdx)
      homes.set(id, p)
      pinnedIds.add(id)
    }

  const byStop = new Map<number, PackBox[]>()
  for (const b of boxes) (byStop.get(b.stopIdx) ?? byStop.set(b.stopIdx, []).get(b.stopIdx)!).push(b)
  const stops = [...byStop.keys()].sort((a, b) => a - b)

  const unplaced: PackBox[] = []
  let frontGi = 0
  let frontZ = 0

  for (const stop of stops) {
    const stopBoxes = byStop.get(stop)!.sort((a, b) => b.size - a.size)
    let endGi = frontGi
    let endZ = frontZ
    const reach = (gi: number, z: number): void => {
      if (gi > endGi || (gi === endGi && z > endZ)) { endGi = gi; endZ = z }
    }

    for (const box of stopBoxes) {
      // a locked box is already seated; just fold its depth into this block
      if (pinnedIds.has(box.id)) {
        const p = homes.get(box.id)!
        reach(giOf(p.gridId), p.z + p.l)
        continue
      }
      const dims = BOX_DIMS[box.size]
      if (!dims) { unplaced.push(box); continue }
      let done = false
      for (let gi = frontGi; gi < bays.length; gi++) {
        const s = bays[gi]
        if (s.grid.maxSize && box.size > s.grid.maxSize) continue
        const minZ = gi === frontGi ? frontZ : 0
        const spot = findSpot(s, dims.w, dims.l, dims.h, minZ, stop, box.size)
        if (!spot) continue
        const p: Placement = { box, gridId: s.grid.id, x: spot.x, y: spot.y, z: spot.z, w: spot.fw, l: spot.fl, h: dims.h, rotated: spot.rotated }
        fill(s, p, stop)
        homes.set(box.id, p)
        reach(gi, spot.z + spot.fl)
        done = true
        break
      }
      if (!done) unplaced.push(box)
    }

    if (endZ + gap < (bays[endGi]?.grid.l ?? 0)) { frontGi = endGi; frontZ = endZ + gap }
    else { frontGi = endGi + 1; frontZ = 0 }
  }

  return { homes, unplaced }
}

export interface WalkOpts {
  loose?: ReadonlySet<string>
  pins?: ReadonlyMap<string, Placement>
  fixtures?: ReadonlyMap<string, Placement>
  gap?: number
}

// Per-step snapshots. Each step repacks only what's aboard right then, so a stop
// delivered earlier frees its room for a later pickup instead of holding the hold
// hostage for the whole run. Everything in one snapshot is aboard together, so the
// section layout can't float.
export function walkPack(grids: CargoGrid[], events: LoadEvent[], opts: WalkOpts = {}): { snaps: LoadSnap[]; concessions: never[] } {
  const loose = opts.loose ?? new Set<string>()
  const boxOf = new Map<string, PackBox>()
  for (const ev of events) for (const b of ev.load) if (!boxOf.has(b.id)) boxOf.set(b.id, b)

  const aboard = new Set<string>()
  const snaps: LoadSnap[] = []
  for (const ev of events) {
    for (const id of ev.drop) aboard.delete(id)
    for (const b of ev.load) aboard.add(b.id)
    const onGrid: PackBox[] = []
    const stepLoose: PackBox[] = []
    for (const id of aboard) {
      const box = boxOf.get(id)!
      if (loose.has(id)) stepLoose.push(box)
      else onGrid.push(box)
    }
    const pins = opts.pins && [...opts.pins.keys()].some((id) => aboard.has(id))
      ? new Map([...opts.pins].filter(([id]) => aboard.has(id)))
      : undefined
    const { homes, unplaced } = packRun(grids, onGrid, { gap: opts.gap, pins, fixtures: opts.fixtures })
    const placements: Placement[] = []
    for (const b of onGrid) { const p = homes.get(b.id); if (p) placements.push(p) }
    snaps.push({ placements, unplaced, loose: stepLoose })
  }

  return { snaps, concessions: [] }
}
