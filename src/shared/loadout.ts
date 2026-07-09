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

// tallies loose boxes by commodity/dest/size, for the loose summary + grab reminder
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
export const BIG = 24 // this size or up counts as a heavy box

export interface SetAside {
  count: number
  scu: number
  big: number
  /** the movers: boxes you lift out of the way */
  boxes: PackBox[]
  /** the cargo those movers sit in front of - what you're digging to reach */
  blocked: PackBox[]
}

// movers you lift aside to unload, not the trapped boxes; the honest shuffle count
export function setAsideToUnload(grids: CargoGrid[], placements: Placement[]): SetAside {
  const byGrid = new Map<string, Placement[]>()
  for (const p of placements) (byGrid.get(p.gridId) ?? byGrid.set(p.gridId, []).get(p.gridId)!).push(p)
  const movers = new Map<string, PackBox>()
  const blocked = new Map<string, PackBox>()
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
        if (yOver && cross) {
          movers.set(q.box.id, q.box)
          blocked.set(p.box.id, p.box)
        }
      }
  }
  const boxes = [...movers.values()]
  return {
    count: boxes.length,
    scu: boxes.reduce((a, b) => a + b.size, 0),
    big: boxes.filter((b) => b.size >= BIG).length,
    boxes,
    blocked: [...blocked.values()]
  }
}

export interface BucketDecision {
  kind: 'none' | 'digout' | 'overload'
  /** overload only: this bucket's boxes that won't fit the grid */
  overloadBoxes: PackBox[]
  /** digout only: this bucket's own boxes you'll set aside to reach earlier cargo */
  digBoxes: PackBox[]
}

// overload vs digout vs none; digout cost is this bucket's own set-aside, not a whole-hold tally
export function bucketDecision(
  setAside: SetAside,
  unplaced: PackBox[],
  loadIds: ReadonlySet<string>
): BucketDecision {
  const overloadBoxes = unplaced.filter((b) => b.objectiveId != null && loadIds.has(b.objectiveId))
  if (overloadBoxes.length) return { kind: 'overload', overloadBoxes, digBoxes: [] }
  const digBoxes = setAside.boxes.filter((b) => b.objectiveId != null && loadIds.has(b.objectiveId))
  return { kind: digBoxes.length ? 'digout' : 'none', overloadBoxes: [], digBoxes }
}

const toOcc = (p: Placement, stopIdx: number): Occupied => ({
  gridId: p.gridId, x: p.x, y: p.y, z: p.z, w: p.w, l: p.l, h: p.h, stopIdx
})

// far edge from the bay exit; later cargo sits past this to peel out clean
function farDepth(g: CargoGrid, p: Placement): number {
  const e = g.exit ?? DEFAULT_EXIT
  return e.axis === 'z' ? (e.dir === -1 ? p.z + p.l : g.l - p.z) : e.dir === -1 ? p.x + p.w : g.w - p.x
}

// seals this box's own lane so later cargo stacks behind it; other lanes stay open
function laneShadow(g: CargoGrid, p: Placement): Occupied | null {
  const e = g.exit ?? DEFAULT_EXIT
  const D = Math.min(farDepth(g, p), e.axis === 'z' ? g.l : g.w)
  if (D <= 0) return null
  const base = { gridId: g.id, y: 0, h: g.h, stopIdx: -1 }
  if (e.axis === 'z')
    return e.dir === -1
      ? { ...base, x: p.x, z: 0, w: p.w, l: D }
      : { ...base, x: p.x, z: g.l - D, w: p.w, l: D }
  return e.dir === -1
    ? { ...base, x: 0, z: p.z, w: D, l: p.l }
    : { ...base, x: g.w - D, z: p.z, w: D, l: p.l }
}

// gives each box one slot for its whole aboard window; overlapping windows contend, dropped ones free space for later cargo
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
  // a covers b only if loaded no later and dropped no earlier; same stop alone isn't enough
  const contains = (a: string, b: string): boolean => loadOf(a) <= loadOf(b) && dropOf(a) >= dropOf(b)

  const assigned = new Map<string, Placement>()
  if (pins) for (const [id, p] of pins) { const b = boxOf.get(id); if (b) assigned.set(id, { ...p, box: b }) }

  // Superbucket units share stop+load step; packer lays each as one contiguous block
  const units = new Map<string, PackBox[]>()
  for (const b of boxOf.values()) {
    if (loose?.has(b.id) || pins?.has(b.id)) continue
    const key = `${b.stopIdx}@${loadOf(b.id)}`
    ;(units.get(key) ?? units.set(key, []).get(key)!).push(b)
  }
  const ordered = [...units.values()].sort(
    (a, b) => a[0].stopIdx - b[0].stopIdx || loadOf(a[0].id) - loadOf(b[0].id)
  )

  // opens a new bay only when the current ones can't seat a unit; consolidates into fewest bays
  const seedFor = (bays: CargoGrid[], rep: string, stopIdx: number): Occupied[] => {
    const inBay = new Set(bays.map((g) => g.id))
    const concurrent = [...assigned.values()].filter((p) => inBay.has(p.gridId) && overlap(p.box.id, rep))
    const seed = concurrent.map((p) => toOcc(p, contains(p.box.id, rep) ? stopIdx : -1))
    // shadow each earlier-delivery box's lane so this cargo peels out behind it
    for (const p of concurrent) {
      if (p.box.stopIdx >= stopIdx) continue
      const g = gridById.get(p.gridId)
      if (g) { const block = laneShadow(g, p); if (block) seed.push(block) }
    }
    return seed
  }

  const openable = grids.filter((g) => g.autoLoad !== false)
  const open: CargoGrid[] = []
  const fits = (bays: CargoGrid[], rep: string, stopIdx: number, unit: PackBox[]): Placement[] | null => {
    const res = packInto(bays, seedFor(bays, rep, stopIdx), unit)
    return res.unplaced.length ? null : res.placements
  }
  for (const unit of ordered) {
    const rep = unit[0].id
    const stopIdx = unit[0].stopIdx
    // try each open bay alone first, then a fresh one; spills only if none fits whole
    let placed: Placement[] | null = null
    for (const b of open) if ((placed = fits([b], rep, stopIdx, unit))) break
    if (!placed) {
      const next = openable.find((g) => !open.includes(g))
      if (next) { open.push(next); placed = fits([next], rep, stopIdx, unit) }
    }
    if (!placed) {
      if (!open.length && openable.length) open.push(openable[0])
      for (;;) {
        const res = packInto(open, seedFor(open, rep, stopIdx), unit)
        placed = res.placements
        if (!res.unplaced.length) break
        const next = openable.find((g) => !open.includes(g))
        if (!next) break
        open.push(next)
      }
    }
    for (const p of placed ?? []) assigned.set(p.box.id, p)
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
