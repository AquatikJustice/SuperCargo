// 3D cargo packer - places every box at a real (x,y,z) cell in a ship's cargo
// grids, the SuperCargo Phase 4 "Option B" exact placement.
//
// Coordinate convention (matches cargoGrids.ts + the three.js view):
//   x = width axis, y = UP / height, z = length axis. A grid is w (x) x h (y) x
//   l (z) cells. A placement's local (x,y,z) is relative to the grid's min corner;
//   add the grid's own (x,y,z) to get the ship-space cell of the box.
//
// Rules (from the game, confirmed with the user):
//   - A box occupies a wxl footprint x h height (see boxGeometry). It must lie
//     FLAT: it can rotate 90 degrees in the horizontal plane (swap w/l) but never tip up.
//   - Boxes rest on the floor or on top of other boxes - never float (support
//     check), matching how you physically stack them.
//   - Readability over density: each DESTINATION is packed as its own contiguous
//     SECTION (delivery order, front to back) with a 1-cell gap before the next,
//     so you can see where one stop's cargo ends and the next begins - the way you
//     load by hand. The first drop-off sits nearest the front/ramp.
//   - Reference-only grids (secure vaults, Ironclad lift pads) are never filled,
//     and a grid's maxSize (largest SCU box it accepts) is honoured.
//
// Pure: no React/zustand, so it's trivially testable.

import type { CargoGrid } from './cargoGrids'
import { BOX_DIMS } from './boxGeometry'

export interface PackBox {
  /** stable id, unique within the pack run. */
  id: string
  /** SCU size (1,2,4,8,16,24,32). */
  size: number
  /** stop colour, carried through for the view. */
  color: string
  /** destination label/code. */
  dest: string
  /** commodity name, for the hover tooltip. */
  commodity?: string
  /** 0-based delivery order (0 = first drop-off). Drives accessibility layering. */
  stopIdx: number
  /** objective this box belongs to, so the loading guide can highlight a stop's cargo. */
  objectiveId?: string
}

export interface Placement {
  box: PackBox
  gridId: string
  /** local min-corner cell within the grid (x=width, y=up, z=length). */
  x: number
  y: number
  z: number
  /** occupied dims after any rotation (w=x extent, l=z extent, h=y extent). */
  w: number
  l: number
  h: number
  /** true if rotated 90 degrees from the box's natural w/l. */
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
  /** boxes that didn't fit anywhere (overflow). */
  unplaced: PackBox[]
  grids: GridFill[]
  /** total loadable capacity across the filled grids. */
  capacity: number
  placedScu: number
  /** true when every box was placed. */
  fits: boolean
  /** true when the roomy per-section layout overflowed and we fell back to a tight
   *  pack (no gaps, holes backfilled) to make everything fit. */
  squeezed: boolean
}

interface GridState {
  grid: CargoGrid
  /** occupancy bitmap, index = x + z*w + y*(w*l) - layered by height (y). */
  occ: Uint8Array
  /** which stop owns each filled cell (-1 = empty), so a box only stacks on its
   *  own destination's cargo, never on another's. */
  owner: Int16Array
  used: number
}

const idx = (g: CargoGrid, x: number, y: number, z: number): number =>
  x + z * g.w + y * (g.w * g.l)

/** Can a footprint (fwxfl on the x/z plane, fh tall) for `stop` sit at local (x,y,z)? */
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
  // every target cell has to be free
  for (let dy = 0; dy < fh; dy++)
    for (let dz = 0; dz < fl; dz++)
      for (let dx = 0; dx < fw; dx++) if (s.occ[idx(g, x + dx, y + dy, z + dz)]) return false
  // support: on the floor, or every cell directly below is filled by THIS stop's
  // cargo. You load a run one destination's boxes at a time, so a box resting on a
  // different stop's pile (loaded at another point in the route) would float.
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

/**
 * First fitting position + orientation at or beyond z = `minZ`, scanned to build
 * COMPACT front-to-back walls: z ascending (front first), then y (bottom-up,
 * supported), then x. Filling a z-slice full-height before stepping back keeps
 * each destination's section tight in z so a gap can separate it from the next.
 */
function findSpot(
  s: GridState,
  w: number,
  l: number,
  h: number,
  minZ: number,
  stop: number
): { x: number; y: number; z: number; fw: number; fl: number; rotated: boolean } | null {
  const g = s.grid
  // a square footprint rotates onto itself, so only try the turned version when it differs
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
  /** leave a 1-cell gap between destination sections (readability). */
  gap: boolean
  /** keep each section after the previous one (contiguous, in delivery order). When
   *  false, every box searches from the first grid, so later stops backfill holes
   *  the sectioned layout would leave empty - denser, but less neatly grouped. */
  contiguous: boolean
}

/**
 * One packing pass. ONE DESTINATION AT A TIME, largest box first within a stop so
 * big boxes anchor the bottom. In contiguous mode each stop gets its own section
 * (delivery order, front to back, optional gap before the next); reference-only
 * grids (autoLoad === false) are skipped and grids reject boxes over their maxSize.
 */
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

  // Frontier: where the NEXT section starts (grid index + z within that grid).
  let frontGi = 0
  let frontZ = 0

  for (const stopIdx of stops) {
    const stopBoxes = (byStop.get(stopIdx) as PackBox[]).sort((a, b) => b.size - a.size)
    const startGi = opts.contiguous ? frontGi : 0
    const startZ = opts.contiguous ? frontZ : 0
    // Furthest extent this section reached, to place the gap + next section.
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

    // Advance the frontier past this section. Dense mode (non-contiguous) lets
    // every stop start from the front, so there's nothing to advance.
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

/**
 * Pack `boxes` into a ship's `grids`. Tries the roomy sectioned layout first (each
 * destination its own block with a gap). If that overflows, repacks TIGHT - no
 * section gaps, holes backfilled - so we only ever report over-capacity when the
 * cargo genuinely won't fit, not when the readable spacing just ran out of room.
 */
export function packCargo(grids: CargoGrid[], boxes: PackBox[]): PackResult {
  const readable = packPass(grids, boxes, { gap: true, contiguous: true })
  if (readable.fits) return readable
  const dense = packPass(grids, boxes, { gap: false, contiguous: false })
  if (dense.placedScu > readable.placedScu) return { ...dense, squeezed: true }
  return readable
}
