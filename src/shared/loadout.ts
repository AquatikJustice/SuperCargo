import type { CargoGrid } from './cargoGrids'
import { packInto, type LoadEvent, type Placement, type PackBox, type Occupied } from './packer'

export interface LoadSnap {
  placements: Placement[]
  unplaced: PackBox[]
  /** aboard but off-grid by choice (overloaded), riding loose in the hold */
  loose: PackBox[]
}

export interface LooseGroup {
  commodity: string
  dest: string
  size: number
  count: number
}

export interface LooseSummary {
  groups: LooseGroup[]
  count: number
  scu: number
}

// Roll a set of off-grid boxes into a readable list: how many of each commodity,
// at what size, bound where. Feeds the riding-loose tally and the "grab your loose
// cargo" reminder at each drop.
export function looseSummary(boxes: PackBox[]): LooseSummary {
  const by = new Map<string, LooseGroup>()
  for (const b of boxes) {
    const commodity = b.commodity ?? 'Cargo'
    const key = `${commodity}|${b.dest}|${b.size}`
    const g = by.get(key) ?? { commodity, dest: b.dest, size: b.size, count: 0 }
    g.count++
    by.set(key, g)
  }
  const groups = [...by.values()].sort((a, b) => a.dest.localeCompare(b.dest) || b.size - a.size)
  return { groups, count: boxes.length, scu: boxes.reduce((a, b) => a + b.size, 0) }
}

const DEFAULT_EXIT = { axis: 'z' as const, dir: -1 as const }
const BIG = 24 // containers this size or larger are the heavy ones to call out

export interface SetAside {
  count: number
  scu: number
  big: number
  boxes: PackBox[]
}

// Boxes you physically lift out of the way to unload in delivery order. Not the
// trapped boxes (provePeel counts those) but the ones sitting in front of them.
// "2 to shuffle" hides that you move fifteen 32-SCU cans to reach them; this is
// the honest number.
export function setAsideToUnload(grids: CargoGrid[], placements: Placement[]): SetAside {
  const byGrid = new Map<string, Placement[]>()
  for (const p of placements) (byGrid.get(p.gridId) ?? byGrid.set(p.gridId, []).get(p.gridId)!).push(p)
  const movers = new Map<string, PackBox>()
  for (const g of grids) {
    const ps = byGrid.get(g.id)
    if (!ps) continue
    const exit = g.exit ?? DEFAULT_EXIT
    const onZ = exit.axis === 'z'
    const depth = (p: Placement): number =>
      onZ ? (exit.dir === -1 ? p.z : g.l - (p.z + p.l)) : exit.dir === -1 ? p.x : g.w - (p.x + p.w)
    for (const p of ps)
      for (const q of ps) {
        if (q === p || q.box.stopIdx <= p.box.stopIdx || depth(q) >= depth(p)) continue
        const yOver = p.y < q.y + q.h && q.y < p.y + p.h
        const cross = onZ ? p.x < q.x + q.w && q.x < p.x + p.w : p.z < q.z + q.l && q.z < p.z + p.l
        if (yOver && cross) movers.set(q.box.id, q.box)
      }
  }
  const boxes = [...movers.values()]
  return { count: boxes.length, scu: boxes.reduce((a, b) => a + b.size, 0), big: boxes.filter((b) => b.size >= BIG).length, boxes }
}

const toOcc = (p: Placement, stopIdx: number): Occupied => ({
  gridId: p.gridId, x: p.x, y: p.y, z: p.z, w: p.w, l: p.l, h: p.h, stopIdx
})

// Incremental loadout: walk the load/drop events in order. Each box gets placed
// once into the space free at that moment and never moves until it's delivered,
// when its cells reopen for later cargo. The packer only ever reserves what's
// genuinely free, so it never invents an over-capacity wall. A box only goes
// unplaced when the hold is honestly full right then.
export interface ScheduleOpts {
  /** box ids the user chose to overload off-grid */
  loose?: ReadonlySet<string>
  /** hand-placed boxes, by id; the packer fixes these and packs the rest around them */
  pins?: ReadonlyMap<string, Placement>
}

export function packSchedule(grids: CargoGrid[], events: LoadEvent[], opts: ScheduleOpts = {}): LoadSnap[] {
  const { loose, pins } = opts
  const placeOf = new Map<string, Placement>()
  const occById = new Map<string, Occupied[]>()
  const looseAboard = new Map<string, PackBox>()

  const reserved = (): Occupied[] => {
    const o: Occupied[] = []
    for (const v of occById.values()) o.push(...v)
    return o
  }
  const place = (b: PackBox): boolean => {
    const res = packInto(grids, reserved(), [b])
    const p = res.placements[0]
    if (!p) return false
    placeOf.set(b.id, p)
    occById.set(b.id, [toOcc(p, b.stopIdx)])
    return true
  }

  const snaps: LoadSnap[] = []
  let pending: PackBox[] = [] // picked up but no room yet; retried each step
  for (const ev of events) {
    for (const id of ev.drop) {
      placeOf.delete(id)
      occById.delete(id)
      looseAboard.delete(id)
    }
    // pins reserve their cells first so the auto boxes pack around them
    const autos: PackBox[] = []
    for (const b of [...pending, ...ev.load]) {
      const pin = pins?.get(b.id)
      if (pin) {
        placeOf.set(b.id, { ...pin, box: b })
        occById.set(b.id, [toOcc(pin, b.stopIdx)])
      } else if (loose?.has(b.id)) looseAboard.set(b.id, b)
      else autos.push(b)
    }
    pending = []
    for (const b of autos) if (!place(b)) pending.push(b)

    snaps.push({ placements: [...placeOf.values()], unplaced: [...pending], loose: [...looseAboard.values()] })
  }
  return snaps
}
