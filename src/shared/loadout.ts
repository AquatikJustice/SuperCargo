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

export interface BucketDecision {
  kind: 'none' | 'digout' | 'overload'
  /** overload only: this bucket's boxes that won't fit the grid */
  overloadBoxes: PackBox[]
}

// what a pickup bucket needs the user to decide: it won't fit (overload), it buries
// earlier-delivery cargo you'll dig out (digout), or nothing (just load it). The dig-out
// COST the card shows is the whole-arrangement setAside, not this bucket's own boxes —
// it counts the boxes you physically handle, which is the honest number.
export function bucketDecision(
  setAside: SetAside,
  unplaced: PackBox[],
  loadIds: ReadonlySet<string>
): BucketDecision {
  const overloadBoxes = unplaced.filter((b) => b.objectiveId != null && loadIds.has(b.objectiveId))
  if (overloadBoxes.length) return { kind: 'overload', overloadBoxes }
  const buries = setAside.boxes.some((b) => b.objectiveId != null && loadIds.has(b.objectiveId))
  return { kind: buries ? 'digout' : 'none', overloadBoxes: [] }
}

const toOcc = (p: Placement, stopIdx: number): Occupied => ({
  gridId: p.gridId, x: p.x, y: p.y, z: p.z, w: p.w, l: p.l, h: p.h, stopIdx
})

// far edge of a placement measured from its bay's exit: the depth the NEXT box behind
// it must clear. Later-delivery cargo has to sit past this to peel out cleanly.
function farDepth(g: CargoGrid, p: Placement): number {
  const e = g.exit ?? DEFAULT_EXIT
  return e.axis === 'z' ? (e.dir === -1 ? p.z + p.l : g.l - p.z) : e.dir === -1 ? p.x + p.w : g.w - p.x
}

// a fake occupancy sealing off every cell shallower than depth D, so packInto is forced
// to lay the box behind the earlier-delivery cargo (it has no fmin knob of its own).
function shallowBlock(g: CargoGrid, D: number): Occupied | null {
  const e = g.exit ?? DEFAULT_EXIT
  const d = Math.min(D, e.axis === 'z' ? g.l : g.w)
  if (d <= 0) return null
  const base = { gridId: g.id, y: 0, h: g.h, stopIdx: -1 }
  if (e.axis === 'z')
    return e.dir === -1
      ? { ...base, x: 0, z: 0, w: g.w, l: d }
      : { ...base, x: 0, z: g.l - d, w: g.w, l: d }
  return e.dir === -1
    ? { ...base, x: 0, z: 0, w: d, l: g.l }
    : { ...base, x: g.w - d, z: 0, w: d, l: g.l }
}

// Interval loadout: assign every box ONE permanent slot up front, in delivery order.
// Two boxes only contend for cells if their aboard windows overlap, so a delivered
// box's space is reclaimed for later cargo (no false over-capacity). Each box is laid
// BEHIND the earlier-delivery cargo it shares the hold with (via a per-bay depth floor),
// so the arrangement peels cleanly at every step and nothing ever has to move.
export interface ScheduleOpts {
  /** box ids the user chose to overload off-grid */
  loose?: ReadonlySet<string>
  /** hand-placed boxes, by id; the packer fixes these and packs the rest around them */
  pins?: ReadonlyMap<string, Placement>
}

export function packSchedule(grids: CargoGrid[], events: LoadEvent[], opts: ScheduleOpts = {}): LoadSnap[] {
  const { loose, pins } = opts
  const gridById = new Map(grids.map((g) => [g.id, g]))

  const boxOf = new Map<string, PackBox>()
  for (const ev of events) for (const b of ev.load) boxOf.set(b.id, b)

  // aboard window [load, drop) per box, from the first time each id loads / drops
  const loadAt = new Map<string, number>()
  const dropAt = new Map<string, number>()
  events.forEach((ev, i) => {
    for (const b of ev.load) if (!loadAt.has(b.id)) loadAt.set(b.id, i)
    for (const id of ev.drop) if (loadAt.has(id) && !dropAt.has(id)) dropAt.set(id, i)
  })
  const loadOf = (id: string): number => loadAt.get(id) ?? 0
  const dropOf = (id: string): number => dropAt.get(id) ?? events.length
  const overlap = (a: string, b: string): boolean =>
    loadOf(a) < dropOf(b) && loadOf(b) < dropOf(a)
  // a can hold b up only if it's aboard the whole time b is: loaded no later, gone no earlier.
  // "same delivery stop" isn't enough (multi-pickup boxes share a stop but load at different
  // steps), so a box stacked on a later-loading neighbour would hang in the air until it arrives.
  const contains = (a: string, b: string): boolean => loadOf(a) <= loadOf(b) && dropOf(a) >= dropOf(b)

  const assigned = new Map<string, Placement>()
  if (pins) for (const [id, p] of pins) { const b = boxOf.get(id); if (b) assigned.set(id, { ...p, box: b }) }

  // earliest delivery first (shallowest), biggest first within a stop to keep walls tight
  const queue = [...boxOf.values()]
    .filter((b) => !loose?.has(b.id) && !pins?.has(b.id))
    .sort((a, b) => a.stopIdx - b.stopIdx || b.size - a.size)

  for (const box of queue) {
    const concurrent = [...assigned.values()].filter((p) => overlap(p.box.id, box.id))
    // tag valid supporters with this box's stop so packInto's restY lets it rest on them;
    // everything else stays a collision-only obstacle it can't sit on (owner -1)
    const seed = concurrent.map((p) => toOcc(p, contains(p.box.id, box.id) ? box.stopIdx : -1))
    // floor each bay to the deepest concurrent EARLIER-delivery cargo so this box sits behind it
    const floor = new Map<string, number>()
    for (const p of concurrent) {
      if (p.box.stopIdx >= box.stopIdx) continue
      const g = gridById.get(p.gridId)
      if (g) floor.set(p.gridId, Math.max(floor.get(p.gridId) ?? 0, farDepth(g, p)))
    }
    for (const [gid, D] of floor) {
      const block = shallowBlock(gridById.get(gid)!, D)
      if (block) seed.push(block)
    }
    const p = packInto(grids, seed, [box]).placements[0]
    if (p) assigned.set(box.id, p)
  }

  const snaps: LoadSnap[] = []
  for (let i = 0; i < events.length; i++) {
    const placements: Placement[] = []
    const unplaced: PackBox[] = []
    const looseNow: PackBox[] = []
    for (const box of boxOf.values()) {
      if (loadOf(box.id) > i || dropOf(box.id) <= i) continue // not aboard now
      if (loose?.has(box.id)) looseNow.push(box)
      else {
        const p = assigned.get(box.id)
        if (p) placements.push(p)
        else unplaced.push(box)
      }
    }
    snaps.push({ placements, unplaced, loose: looseNow })
  }
  return snaps
}
