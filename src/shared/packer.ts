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
  // support: floor, or every cell below filled by this stop
  if (y > 0) {
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) {
        const b = idx(g, x + dx, y - 1, z + dz)
        if (!s.occ[b] || s.owner[b] !== stop) return false
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

// first fit at/beyond minZ. scan z, then y bottom-up, then x.
function findSpot(
  s: GridState,
  w: number,
  l: number,
  h: number,
  minZ: number,
  stop: number
): { x: number; y: number; z: number; fw: number; fl: number; rotated: boolean } | null {
  const g = s.grid
  // skip the rotated orientation when square
  const orients: Array<[number, number, boolean]> =
    w === l ? [[w, l, false]] : [[w, l, false], [l, w, true]]
  for (let z = Math.max(0, minZ); z + 1 <= g.l; z++) {
    for (let y = 0; y + h <= g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        for (const [fw, fl, rotated] of orients) {
          if (canPlace(s, x, y, z, fw, fl, h, stop)) return { x, y, z, fw, fl, rotated }
        }
      }
    }
  }
  return null
}

interface PackOpts {
  /** 1-cell gap between sections. */
  gap: boolean
  /** each section after the previous one. false = denser backfill. */
  contiguous: boolean
}

// one pass, one stop at a time, largest box first.
function packPass(grids: CargoGrid[], boxes: PackBox[], opts: PackOpts): PackResult {
  const loadable = grids.filter((g) => g.autoLoad !== false)
  const states: GridState[] = loadable.map((grid) => ({
    grid,
    occ: new Uint8Array(grid.w * grid.l * grid.h),
    owner: new Int16Array(grid.w * grid.l * grid.h).fill(-1),
    used: 0
  }))

  const byStop = new Map<number, PackBox[]>()
  for (const b of boxes) {
    const arr = byStop.get(b.stopIdx)
    if (arr) arr.push(b)
    else byStop.set(b.stopIdx, [b])
  }
  const stops = [...byStop.keys()].sort((a, b) => a - b)

  const placements: Placement[] = []
  const unplaced: PackBox[] = []

  // where the next section starts
  let frontGi = 0
  let frontZ = 0

  for (const stopIdx of stops) {
    const stopBoxes = (byStop.get(stopIdx) as PackBox[]).sort((a, b) => b.size - a.size)
    const startGi = opts.contiguous ? frontGi : 0
    const startZ = opts.contiguous ? frontZ : 0
    // furthest this section reached, for the gap + next section
    let endGi = startGi
    let endZ = startZ

    for (const box of stopBoxes) {
      const dims = BOX_DIMS[box.size]
      if (!dims) {
        unplaced.push(box)
        continue
      }
      let placed = false
      for (let gi = startGi; gi < states.length; gi++) {
        const s = states[gi]
        if (s.grid.maxSize && box.size > s.grid.maxSize) continue
        const minZ = opts.contiguous && gi === startGi ? startZ : 0
        const spot = findSpot(s, dims.w, dims.l, dims.h, minZ, stopIdx)
        if (!spot) continue
        fill(s, spot.x, spot.y, spot.z, spot.fw, spot.fl, dims.h, stopIdx)
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
        const reach = spot.z + spot.fl
        if (gi > endGi || (gi === endGi && reach > endZ)) {
          endGi = gi
          endZ = reach
        }
        placed = true
        break
      }
      if (!placed) unplaced.push(box)
    }

    if (opts.contiguous) {
      const gapZ = opts.gap ? 1 : 0
      if (endZ + gapZ < states[endGi]?.grid.l) {
        frontGi = endGi
        frontZ = endZ + gapZ
      } else {
        frontGi = endGi + 1
        frontZ = 0
      }
    }
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

// roomy sectioned layout first; if it overflows, repack tight so we only
// report over-capacity when the cargo truly won't fit.
export function packCargo(grids: CargoGrid[], boxes: PackBox[]): PackResult {
  const readable = packPass(grids, boxes, { gap: true, contiguous: true })
  if (readable.fits) return readable
  const dense = packPass(grids, boxes, { gap: false, contiguous: false })
  if (dense.placedScu > readable.placedScu) return { ...dense, squeezed: true }
  return readable
}
