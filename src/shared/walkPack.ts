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
  born: Int32Array // load step of the box in each cell, for the no-later-support rule
  used: number
}

const idx = (g: CargoGrid, x: number, y: number, z: number): number => x + z * g.w + y * (g.w * g.l)

function makeBay(grid: CargoGrid): Bay {
  const n = grid.w * grid.l * grid.h
  return { grid, occ: new Uint8Array(n), owner: new Int16Array(n).fill(-1), born: new Int32Array(n).fill(-1), used: 0 }
}

function canPlace(s: Bay, x: number, y: number, z: number, fw: number, fl: number, fh: number, stop: number, step: number): boolean {
  const g = s.grid
  if (x + fw > g.w || z + fl > g.l || y + fh > g.h) return false
  for (let dy = 0; dy < fh; dy++)
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) if (s.occ[idx(g, x + dx, y + dy, z + dz)]) return false
  if (y > 0) {
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) {
        const b = idx(g, x + dx, y - 1, z + dz)
        if (!s.occ[b] || s.owner[b] !== stop || s.born[b] > step) return false
      }
  }
  return true
}

function fill(s: Bay, p: Placement, owner: number, step: number): void {
  const g = s.grid
  for (let dy = 0; dy < p.h; dy++)
    for (let dz = 0; dz < p.l; dz++)
      for (let dx = 0; dx < p.w; dx++) {
        const i = idx(g, p.x + dx, p.y + dy, p.z + dz)
        if (i < 0 || i >= s.occ.length) continue
        s.occ[i] = 1
        s.owner[i] = owner
        s.born[i] = step
      }
  s.used += p.w * p.l * p.h
}

// First fit at or beyond z = minZ, scanned z (front) then y (bottom-up) then x, so
// each section fills a full-height wall before stepping back and stays tight in z.
function findSpot(
  s: Bay,
  w: number,
  l: number,
  h: number,
  minZ: number,
  stop: number,
  step: number
): { x: number; y: number; z: number; fw: number; fl: number; rotated: boolean } | null {
  const g = s.grid
  const orients: Array<[number, number, boolean]> = w === l ? [[w, l, false]] : [[w, l, false], [l, w, true]]
  for (let z = Math.max(0, minZ); z + 1 <= g.l; z++)
    for (let y = 0; y + h <= g.h; y++)
      for (let x = 0; x < g.w; x++)
        for (const [fw, fl, rotated] of orients) if (canPlace(s, x, y, z, fw, fl, h, stop, step)) return { x, y, z, fw, fl, rotated }
  return null
}

export interface RunOpts {
  gap?: number
  /** load step per box id (first boarding), default 0. Drives the no-later-support rule. */
  loadStep?: ReadonlyMap<string, number>
  pins?: ReadonlyMap<string, Placement>
  fixtures?: ReadonlyMap<string, Placement>
}

// Static layout: one fixed home per box, sectioned by destination.
export function packRun(grids: CargoGrid[], boxes: PackBox[], opts: RunOpts = {}): { homes: Map<string, Placement>; unplaced: PackBox[] } {
  const gap = opts.gap ?? 0
  const stepOf = (id: string): number => opts.loadStep?.get(id) ?? 0
  const bays = grids.filter((g) => g.autoLoad !== false).map(makeBay)
  const byId = new Map(bays.map((b) => [b.grid.id, b]))

  if (opts.fixtures) for (const f of opts.fixtures.values()) { const b = byId.get(f.gridId); if (b) fill(b, f, FIXTURE, -1) }

  const homes = new Map<string, Placement>()
  const pinned = new Set<string>()
  if (opts.pins)
    for (const [id, p] of opts.pins) {
      const b = byId.get(p.gridId)
      if (!b) continue
      fill(b, p, p.box.stopIdx, stepOf(id))
      homes.set(id, p)
      pinned.add(id)
    }

  const byStop = new Map<number, PackBox[]>()
  for (const b of boxes) {
    if (pinned.has(b.id)) continue
    ;(byStop.get(b.stopIdx) ?? byStop.set(b.stopIdx, []).get(b.stopIdx)!).push(b)
  }
  const stops = [...byStop.keys()].sort((a, b) => a - b)

  const unplaced: PackBox[] = []
  let frontGi = 0
  let frontZ = 0

  for (const stop of stops) {
    const stopBoxes = byStop.get(stop)!.sort((a, b) => b.size - a.size)
    let endGi = frontGi
    let endZ = frontZ

    for (const box of stopBoxes) {
      const dims = BOX_DIMS[box.size]
      if (!dims) { unplaced.push(box); continue }
      let done = false
      for (let gi = frontGi; gi < bays.length; gi++) {
        const s = bays[gi]
        if (s.grid.maxSize && box.size > s.grid.maxSize) continue
        const minZ = gi === frontGi ? frontZ : 0
        const spot = findSpot(s, dims.w, dims.l, dims.h, minZ, stop, stepOf(box.id))
        if (!spot) continue
        const p: Placement = { box, gridId: s.grid.id, x: spot.x, y: spot.y, z: spot.z, w: spot.fw, l: spot.fl, h: dims.h, rotated: spot.rotated }
        fill(s, p, stop, stepOf(box.id))
        homes.set(box.id, p)
        const reach = spot.z + spot.fl
        if (gi > endGi || (gi === endGi && reach > endZ)) { endGi = gi; endZ = reach }
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

// Per-step snapshots off the static layout: reveal boxes as they board, hide them
// as they leave, everyone else stays put.
export function walkPack(grids: CargoGrid[], events: LoadEvent[], opts: WalkOpts = {}): { snaps: LoadSnap[]; concessions: never[] } {
  const loose = opts.loose ?? new Set<string>()
  const boxOf = new Map<string, PackBox>()
  const loadStep = new Map<string, number>()
  const onGrid: PackBox[] = []
  events.forEach((ev, i) => {
    for (const b of ev.load)
      if (!boxOf.has(b.id)) {
        boxOf.set(b.id, b)
        loadStep.set(b.id, i)
        if (!loose.has(b.id)) onGrid.push(b)
      }
  })

  const { homes, unplaced } = packRun(grids, onGrid, { gap: opts.gap, loadStep, pins: opts.pins, fixtures: opts.fixtures })
  const homeless = new Set(unplaced.map((b) => b.id))

  const aboard = new Set<string>()
  const snaps: LoadSnap[] = []
  for (const ev of events) {
    for (const id of ev.drop) aboard.delete(id)
    for (const b of ev.load) aboard.add(b.id)
    const placements: Placement[] = []
    const stepUnplaced: PackBox[] = []
    const stepLoose: PackBox[] = []
    for (const id of aboard) {
      const box = boxOf.get(id)!
      if (loose.has(id)) stepLoose.push(box)
      else if (homeless.has(id)) stepUnplaced.push(box)
      else { const p = homes.get(id); if (p) placements.push(p) }
    }
    snaps.push({ placements, unplaced: stepUnplaced, loose: stepLoose })
  }

  return { snaps, concessions: [] }
}
