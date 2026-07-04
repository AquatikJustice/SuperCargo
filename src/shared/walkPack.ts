// The loading-walk packer. Lays the WHOLE run out once into tight per-destination
// sections (delivery order, front to back, big boxes on the bottom) and then the
// walk just reveals or hides boxes by what's aboard at each step. Homes never move,
// which is what keeps it looking clean while you load.
//
// This is deliberately its own module: it's the 0.6.0 sectioned packer, kept away
// from the exit-face/floor helpers in packer.ts that evolved past it.

import type { CargoGrid } from './cargoGrids'
import { BOX_DIMS } from './boxGeometry'
import type { LoadEvent, Placement, PackBox } from './packer'
import type { LoadSnap } from './loadout'

const FIXTURE = -2 // owns crate cells; nothing stacks on it

interface Bay {
  grid: CargoGrid
  occ: Uint8Array
  owner: Int16Array
  used: number
}

const idx = (g: CargoGrid, x: number, y: number, z: number): number => x + z * g.w + y * (g.w * g.l)

function canPlace(s: Bay, x: number, y: number, z: number, fw: number, fl: number, fh: number, stop: number): boolean {
  const g = s.grid
  if (x + fw > g.w || z + fl > g.l || y + fh > g.h) return false
  for (let dy = 0; dy < fh; dy++)
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) if (s.occ[idx(g, x + dx, y + dy, z + dz)]) return false
  // on the floor, or resting fully on this stop's own cargo. You load one
  // destination at a time, so a box perched on another stop's pile would float.
  if (y > 0) {
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) {
        const b = idx(g, x + dx, y - 1, z + dz)
        if (!s.occ[b] || s.owner[b] !== stop) return false
      }
  }
  return true
}

function fill(s: Bay, x: number, y: number, z: number, fw: number, fl: number, fh: number, stop: number): void {
  const g = s.grid
  for (let dy = 0; dy < fh; dy++)
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) {
        const i = idx(g, x + dx, y + dy, z + dz)
        s.occ[i] = 1
        s.owner[i] = stop
      }
  s.used += fw * fl * fh
}

// First fit at or beyond z = minZ, scanned z (front) then y (bottom-up) then x, so
// each section fills a full-height wall before stepping back and stays tight in z.
function findSpot(
  s: Bay,
  w: number,
  l: number,
  h: number,
  minZ: number,
  stop: number
): { x: number; y: number; z: number; fw: number; fl: number; rotated: boolean } | null {
  const g = s.grid
  const orients: Array<[number, number, boolean]> = w === l ? [[w, l, false]] : [[w, l, false], [l, w, true]]
  for (let z = Math.max(0, minZ); z + 1 <= g.l; z++)
    for (let y = 0; y + h <= g.h; y++)
      for (let x = 0; x < g.w; x++)
        for (const [fw, fl, rotated] of orients) if (canPlace(s, x, y, z, fw, fl, h, stop)) return { x, y, z, fw, fl, rotated }
  return null
}

function seed(bay: Bay, p: Placement, owner: number): void {
  const g = bay.grid
  for (let dy = 0; dy < p.h; dy++)
    for (let dz = 0; dz < p.l; dz++)
      for (let dx = 0; dx < p.w; dx++) {
        const i = idx(g, p.x + dx, p.y + dy, p.z + dz)
        if (i < 0 || i >= bay.occ.length) continue
        bay.occ[i] = 1
        bay.owner[i] = owner
      }
}

interface RunOpts {
  gap: number
  pins?: ReadonlyMap<string, Placement>
  fixtures?: ReadonlyMap<string, Placement>
}

// Static full-run layout: fixed home per box for the whole trip.
function packRun(grids: CargoGrid[], boxes: PackBox[], opts: RunOpts): { homes: Map<string, Placement>; unplaced: PackBox[] } {
  const loadable = grids.filter((g) => g.autoLoad !== false)
  const bays: Bay[] = loadable.map((grid) => ({
    grid,
    occ: new Uint8Array(grid.w * grid.l * grid.h),
    owner: new Int16Array(grid.w * grid.l * grid.h).fill(-1),
    used: 0
  }))
  const byId = new Map(bays.map((b) => [b.grid.id, b]))

  if (opts.fixtures) for (const f of opts.fixtures.values()) { const b = byId.get(f.gridId); if (b) seed(b, f, FIXTURE) }

  const homes = new Map<string, Placement>()
  const pinned = new Set<string>()
  if (opts.pins)
    for (const [id, p] of opts.pins) {
      const b = byId.get(p.gridId)
      if (!b) continue
      seed(b, p, p.box.stopIdx)
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
    const startGi = frontGi
    let endGi = startGi
    let endZ = frontZ

    for (const box of stopBoxes) {
      const dims = BOX_DIMS[box.size]
      if (!dims) { unplaced.push(box); continue }
      let done = false
      for (let gi = startGi; gi < bays.length; gi++) {
        const s = bays[gi]
        if (s.grid.maxSize && box.size > s.grid.maxSize) continue
        const minZ = gi === startGi ? frontZ : 0
        const spot = findSpot(s, dims.w, dims.l, dims.h, minZ, stop)
        if (!spot) continue
        fill(s, spot.x, spot.y, spot.z, spot.fw, spot.fl, dims.h, stop)
        homes.set(box.id, { box, gridId: s.grid.id, x: spot.x, y: spot.y, z: spot.z, w: spot.fw, l: spot.fl, h: dims.h, rotated: spot.rotated })
        const reach = spot.z + spot.fl
        if (gi > endGi || (gi === endGi && reach > endZ)) { endGi = gi; endZ = reach }
        done = true
        break
      }
      if (!done) unplaced.push(box)
    }

    const gapZ = opts.gap
    if (endZ + gapZ < (bays[endGi]?.grid.l ?? 0)) { frontGi = endGi; frontZ = endZ + gapZ }
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

// Per-step snapshots off one static layout: reveal boxes as they board, drop them
// as they leave, keep everyone else exactly where the pack put them.
export function walkPack(grids: CargoGrid[], events: LoadEvent[], opts: WalkOpts = {}): { snaps: LoadSnap[]; concessions: never[] } {
  const loose = opts.loose ?? new Set<string>()
  const boxOf = new Map<string, PackBox>()
  const onGrid: PackBox[] = []
  for (const ev of events)
    for (const b of ev.load)
      if (!boxOf.has(b.id)) {
        boxOf.set(b.id, b)
        if (!loose.has(b.id)) onGrid.push(b)
      }

  const { homes, unplaced } = packRun(grids, onGrid, { gap: opts.gap ?? 0, pins: opts.pins, fixtures: opts.fixtures })
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
