// 3D cargo packer. coords: x = width, y = up, z = length. local (x,y,z) is
// relative to the grid's min corner.

import type { CargoGrid } from './cargoGrids'
import { BOX_DIMS } from './boxGeometry'

export interface PackBox {
  id: string
  size: number
  color: string
  dest: string
  commodity?: string
  /** 0-based delivery order (0 = first drop-off). */
  stopIdx: number
  objectiveId?: string
}

export interface Placement {
  box: PackBox
  gridId: string
  /** local min-corner cell. */
  x: number
  y: number
  z: number
  /** dims after rotation. */
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

export interface PackResult {
  placements: Placement[]
  unplaced: PackBox[]
  grids: GridFill[]
  capacity: number
  placedScu: number
  fits: boolean
  /** true when we fell back to the tight pack. */
  squeezed: boolean
}

interface GridState {
  grid: CargoGrid
  occ: Uint8Array
  /** stop owning each filled cell (-1 = empty), so a box only stacks on its own. */
  owner: Int16Array
  used: number
}

const idx = (g: CargoGrid, x: number, y: number, z: number): number =>
  x + z * g.w + y * (g.w * g.l)

function canPlace(
  s: GridState,
  x: number,
  y: number,
  z: number,
  fw: number,
  fl: number,
  fh: number,
  stop: number
): boolean {
  const g = s.grid
  if (x + fw > g.w || z + fl > g.l || y + fh > g.h) return false
  for (let dy = 0; dy < fh; dy++)
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) if (s.occ[idx(g, x + dx, y + dy, z + dz)]) return false
  // support: floor, or a full platform below with no holes. and the platform
  // must be cargo delivered no earlier than this box (owner stop >= stop), so
  // an earlier drop-off never ends up buried under a later one
  if (y > 0) {
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) {
        const b = idx(g, x + dx, y - 1, z + dz)
        if (!s.occ[b] || s.owner[b] < stop) return false
      }
  }
  return true
}

function fill(s: GridState, x: number, y: number, z: number, fw: number, fl: number, fh: number, stop: number): void {
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

// lowest free spot: fill the floor first (y bottom-up), front to back, so the
// hold builds in flat layers
function findSpot(
  s: GridState,
  w: number,
  l: number,
  h: number,
  stop: number
): { x: number; y: number; z: number; fw: number; fl: number; rotated: boolean } | null {
  const g = s.grid
  // skip the rotated orientation when square
  const orients: Array<[number, number, boolean]> =
    w === l ? [[w, l, false]] : [[w, l, false], [l, w, true]]
  for (let y = 0; y + h <= g.h; y++) {
    for (let z = 0; z + 1 <= g.l; z++) {
      for (let x = 0; x < g.w; x++) {
        for (const [fw, fl, rotated] of orients) {
          if (canPlace(s, x, y, z, fw, fl, h, stop)) return { x, y, z, fw, fl, rotated }
        }
      }
    }
  }
  return null
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

// place `boxes` into the space left by already-placed cargo, never moving it.
// used to slot late additions into a frozen hold.
export function packInto(
  grids: CargoGrid[],
  occupied: Occupied[],
  boxes: PackBox[]
): { placements: Placement[]; unplaced: PackBox[] } {
  const loadable = grids.filter((g) => g.autoLoad !== false)
  const states: GridState[] = loadable.map((grid) => ({
    grid,
    occ: new Uint8Array(grid.w * grid.l * grid.h),
    owner: new Int16Array(grid.w * grid.l * grid.h).fill(-1),
    used: 0
  }))
  const byId = new Map(states.map((s) => [s.grid.id, s]))
  for (const o of occupied) {
    const s = byId.get(o.gridId)
    if (s) fill(s, o.x, o.y, o.z, o.w, o.l, o.h, o.stopIdx)
  }

  const ordered = [...boxes].sort((a, b) => b.stopIdx - a.stopIdx || b.size - a.size)
  const placements: Placement[] = []
  const unplaced: PackBox[] = []
  for (const box of ordered) {
    const dims = BOX_DIMS[box.size]
    if (!dims) {
      unplaced.push(box)
      continue
    }
    let placed = false
    for (const s of states) {
      if (s.grid.maxSize && box.size > s.grid.maxSize) continue
      const spot = findSpot(s, dims.w, dims.l, dims.h, box.stopIdx)
      if (!spot) continue
      fill(s, spot.x, spot.y, spot.z, spot.fw, spot.fl, dims.h, box.stopIdx)
      placements.push({
        box,
        gridId: s.grid.id,
        x: spot.x,
        y: spot.y,
        z: spot.z,
        w: spot.fw,
        l: spot.fl,
        h: dims.h,
        rotated: spot.rotated
      })
      placed = true
      break
    }
    if (!placed) unplaced.push(box)
  }
  return { placements, unplaced }
}

// one dense pass. later drop-offs go down first so they end up on the bottom
// and the earlier ones ride on top, reachable. bigger boxes first to pack tight.
export function packCargo(grids: CargoGrid[], boxes: PackBox[]): PackResult {
  const loadable = grids.filter((g) => g.autoLoad !== false)
  const states: GridState[] = loadable.map((grid) => ({
    grid,
    occ: new Uint8Array(grid.w * grid.l * grid.h),
    owner: new Int16Array(grid.w * grid.l * grid.h).fill(-1),
    used: 0
  }))

  const ordered = [...boxes].sort((a, b) => b.stopIdx - a.stopIdx || b.size - a.size)
  const placements: Placement[] = []
  const unplaced: PackBox[] = []

  for (const box of ordered) {
    const dims = BOX_DIMS[box.size]
    if (!dims) {
      unplaced.push(box)
      continue
    }
    let placed = false
    for (let gi = 0; gi < states.length; gi++) {
      const s = states[gi]
      if (s.grid.maxSize && box.size > s.grid.maxSize) continue
      const spot = findSpot(s, dims.w, dims.l, dims.h, box.stopIdx)
      if (!spot) continue
      fill(s, spot.x, spot.y, spot.z, spot.fw, spot.fl, dims.h, box.stopIdx)
      placements.push({
        box,
        gridId: s.grid.id,
        x: spot.x,
        y: spot.y,
        z: spot.z,
        w: spot.fw,
        l: spot.fl,
        h: dims.h,
        rotated: spot.rotated
      })
      placed = true
      break
    }
    if (!placed) unplaced.push(box)
  }

  const capacity = loadable.reduce((a, g) => a + g.w * g.l * g.h, 0)
  const placedScu = placements.reduce((a, p) => a + p.box.size, 0)
  return {
    placements,
    unplaced,
    grids: states.map((s) => ({
      id: s.grid.id,
      name: s.grid.name,
      w: s.grid.w,
      l: s.grid.l,
      h: s.grid.h,
      capacity: s.grid.w * s.grid.l * s.grid.h,
      used: s.used
    })),
    capacity,
    placedScu,
    fits: unplaced.length === 0,
    squeezed: false
  }
}
