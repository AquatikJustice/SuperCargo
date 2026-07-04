// The loading-walk packer. Walks the route step by step, placing each pickup's
// boxes into whatever room is free right then and freeing a stop's cells when it's
// delivered, so the hold only ever holds what's actually aboard. A box keeps the
// spot it was first given for the rest of its trip, which is what keeps the stacks
// looking settled instead of re-dealing every step.
//
// Placement is the tight 0.6.0 style: biggest box first so it anchors the floor,
// front to back, and a box only ever rests on its own destination's cargo, so each
// stop grows as its own tower and nothing floats when a delivery pulls out.
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
  used: number
}

const idx = (g: CargoGrid, x: number, y: number, z: number): number => x + z * g.w + y * (g.w * g.l)

function canPlace(s: Bay, x: number, y: number, z: number, fw: number, fl: number, fh: number, stop: number): boolean {
  const g = s.grid
  if (x + fw > g.w || z + fl > g.l || y + fh > g.h) return false
  for (let dy = 0; dy < fh; dy++)
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) if (s.occ[idx(g, x + dx, y + dy, z + dz)]) return false
  // floor, or resting fully on this stop's own cargo. Same-stop boxes board and
  // leave together, so support is always aboard while the box on top is.
  if (y > 0) {
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) {
        const b = idx(g, x + dx, y - 1, z + dz)
        if (!s.occ[b] || s.owner[b] !== stop) return false
      }
  }
  return true
}

function paint(s: Bay, x: number, y: number, z: number, fw: number, fl: number, fh: number, owner: number, on: boolean): void {
  const g = s.grid
  for (let dy = 0; dy < fh; dy++)
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) {
        const i = idx(g, x + dx, y + dy, z + dz)
        if (i < 0 || i >= s.occ.length) continue
        s.occ[i] = on ? 1 : 0
        s.owner[i] = on ? owner : -1
      }
  s.used += (on ? 1 : -1) * fw * fl * fh
}

// First fit, z (front) then y (bottom-up) then x, so a stop fills a full-height
// wall before stepping back and stays tight in z.
function findSpot(
  s: Bay,
  w: number,
  l: number,
  h: number,
  stop: number
): { x: number; y: number; z: number; fw: number; fl: number; rotated: boolean } | null {
  const g = s.grid
  const orients: Array<[number, number, boolean]> = w === l ? [[w, l, false]] : [[w, l, false], [l, w, true]]
  for (let z = 0; z + 1 <= g.l; z++)
    for (let y = 0; y + h <= g.h; y++)
      for (let x = 0; x < g.w; x++)
        for (const [fw, fl, rotated] of orients) if (canPlace(s, x, y, z, fw, fl, h, stop)) return { x, y, z, fw, fl, rotated }
  return null
}

export interface WalkOpts {
  loose?: ReadonlySet<string>
  pins?: ReadonlyMap<string, Placement>
  fixtures?: ReadonlyMap<string, Placement>
  gap?: number
}

export function walkPack(grids: CargoGrid[], events: LoadEvent[], opts: WalkOpts = {}): { snaps: LoadSnap[]; concessions: never[] } {
  const loose = opts.loose ?? new Set<string>()
  const bays: Bay[] = grids
    .filter((g) => g.autoLoad !== false)
    .map((grid) => ({
      grid,
      occ: new Uint8Array(grid.w * grid.l * grid.h),
      owner: new Int16Array(grid.w * grid.l * grid.h).fill(-1),
      used: 0
    }))
  const byId = new Map(bays.map((b) => [b.grid.id, b]))

  if (opts.fixtures)
    for (const f of opts.fixtures.values()) {
      const b = byId.get(f.gridId)
      if (b) paint(b, f.x, f.y, f.z, f.w, f.l, f.h, FIXTURE, true)
    }

  const boxOf = new Map<string, PackBox>()
  for (const ev of events) for (const b of ev.load) if (!boxOf.has(b.id)) boxOf.set(b.id, b)

  const placed = new Map<string, Placement>()
  const aboard = new Set<string>()

  const place = (box: PackBox): void => {
    if (placed.has(box.id)) return
    const pin = opts.pins?.get(box.id)
    if (pin) {
      const bay = byId.get(pin.gridId)
      if (bay) {
        paint(bay, pin.x, pin.y, pin.z, pin.w, pin.l, pin.h, box.stopIdx, true)
        placed.set(box.id, pin)
        return
      }
    }
    const dims = BOX_DIMS[box.size]
    if (!dims) return
    for (const bay of bays) {
      if (bay.grid.maxSize && box.size > bay.grid.maxSize) continue
      const spot = findSpot(bay, dims.w, dims.l, dims.h, box.stopIdx)
      if (!spot) continue
      paint(bay, spot.x, spot.y, spot.z, spot.fw, spot.fl, dims.h, box.stopIdx, true)
      placed.set(box.id, { box, gridId: bay.grid.id, x: spot.x, y: spot.y, z: spot.z, w: spot.fw, l: spot.fl, h: dims.h, rotated: spot.rotated })
      return
    }
  }

  const snaps: LoadSnap[] = []
  for (const ev of events) {
    for (const id of ev.drop) {
      aboard.delete(id)
      const p = placed.get(id)
      if (p) {
        const bay = byId.get(p.gridId)
        if (bay) paint(bay, p.x, p.y, p.z, p.w, p.l, p.h, 0, false)
        placed.delete(id)
      }
    }
    // biggest first so the big boxes claim the floor and smalls ride on top
    for (const b of [...ev.load].sort((a, b) => b.size - a.size)) {
      aboard.add(b.id)
      if (!loose.has(b.id)) place(b)
    }
    const placements: Placement[] = []
    const unplaced: PackBox[] = []
    const stepLoose: PackBox[] = []
    for (const id of aboard) {
      const box = boxOf.get(id)!
      if (loose.has(id)) stepLoose.push(box)
      else {
        const p = placed.get(id)
        if (p) placements.push(p)
        else unplaced.push(box)
      }
    }
    snaps.push({ placements, unplaced, loose: stepLoose })
  }

  return { snaps, concessions: [] }
}
