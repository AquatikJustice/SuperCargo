// One hold model for feasibility, the grid, and the loading walk.
// Boxes get one permanent slot; two boxes only contend when their
// aboard windows overlap, so delivered cargo's space comes back.

import type { CargoGrid } from './cargoGrids'
import { BOX_DIMS } from './boxGeometry'
import type { PackBox, Placement, LoadEvent } from './packer'
import type { LoadSnap } from './loadout'

const NEVER = 1 << 29

export interface Frame {
  exit: { axis: 'x' | 'z'; dir: -1 | 1 }
  /** face cargo rests on; stacking grows away from it. Default 'y-' */
  floor?: 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-'
}

export interface HoldOpts {
  loose?: ReadonlySet<string>
  pins?: ReadonlyMap<string, Placement>
  /** the previous plan's placements: a box that still fits its old spot
   *  keeps it, so a re-plan never re-deals cargo the user already saw settled */
  prev?: ReadonlyMap<string, Placement>
  /** empty cells kept between different-stop blocks while space allows */
  gap?: number
  frames?: ReadonlyMap<string, Frame>
}

export interface UnitVerdict {
  stop: number
  load: number
  ok: boolean
  boxes: PackBox[]
  reason?: 'space'
}

export interface Concession {
  boxId: string
  /** peel = out of delivery-depth order, unloads around it need lift-outs;
   *  flank = pins a neighbor (game bug), plan a shuffle at its drop;
   *  build = loads buried, a dig-out */
  kind: 'peel' | 'flank' | 'build'
}

export interface HoldProofs {
  floatOk: boolean
  buildOk: boolean
  extractOk: boolean
  issues: string[]
}

export interface HoldPlan {
  snaps: LoadSnap[]
  verdicts: UnitVerdict[]
  concessions: Concession[]
  proofs: HoldProofs
}

type Axis = 'x' | 'y' | 'z'

// bay-local frame: d runs exit-inward, c across, y away from the floor face.
// Each canonical dimension maps to one grid axis with an optional flip
interface BayCtx {
  idx: number
  grid: CargoGrid
  cw: number
  dl: number
  h: number
  cross: Axis
  /** c measured from the axis plus face */
  crossFlip: boolean
  depth: Axis
  /** exit sits at the axis plus face */
  depthFlip: boolean
  up: Axis
  /** floor sits at the axis plus face, so up runs minus */
  upFlip: boolean
  /** stacks hug the high side of the cross axis */
  wallHigh: boolean
}

const axisLen = (g: CargoGrid, a: Axis): number => (a === 'x' ? g.w : a === 'y' ? g.h : g.l)

function wallIsHigh(grid: CargoGrid, cross: Axis): boolean {
  const f = grid.faces
  if (!f) return false
  const hi = f[`${cross}+` as keyof typeof f]
  const lo = f[`${cross}-` as keyof typeof f]
  if (hi === 'wall' || lo === 'aisle') return true
  return false
}

interface Slot {
  box: PackBox
  bay: number
  c: number
  d: number
  y: number
  cw: number
  dl: number
  h: number
  load: number
  drop: number
  stop: number
  anchor: boolean
  /** placed by the user's hand: physics binds it, zoning aesthetics don't */
  pinned?: boolean
}

function bayCtx(grid: CargoGrid, idx: number, frame?: Frame): BayCtx {
  const exit = frame?.exit ?? grid.exit ?? { axis: 'z' as const, dir: -1 as const }
  const floor = frame?.floor ?? grid.floor ?? 'y-'
  let up = floor[0] as Axis
  let upFlip = floor[1] === '+'
  // an exit through the floor axis can't carry a horizontal peel; keep the
  // default deck rather than guessing
  if (exit.axis === up) {
    up = 'y'
    upFlip = false
  }
  const depth = exit.axis
  const cross = (['x', 'y', 'z'] as Axis[]).find((a) => a !== up && a !== depth)!
  return {
    idx,
    grid,
    cw: axisLen(grid, cross),
    dl: axisLen(grid, depth),
    h: axisLen(grid, up),
    cross,
    crossFlip: false,
    depth,
    depthFlip: exit.dir === 1,
    up,
    upFlip,
    wallHigh: wallIsHigh(grid, cross)
  }
}

// canonical (c,d,y) <-> grid-local (x,y,z): each canonical dimension writes
// one grid axis, flipped when its reference face sits on the plus side
function toPlacement(b: BayCtx, s: Slot): Placement {
  const dims = BOX_DIMS[s.box.size]
  const pos = { x: 0, y: 0, z: 0 }
  const ext = { x: 0, y: 0, z: 0 }
  const put = (axis: Axis, at: number, size: number, flip: boolean): void => {
    pos[axis] = flip ? axisLen(b.grid, axis) - (at + size) : at
    ext[axis] = size
  }
  put(b.cross, s.c, s.cw, b.crossFlip)
  put(b.depth, s.d, s.dl, b.depthFlip)
  put(b.up, s.y, s.h, b.upFlip)
  return {
    box: s.box,
    gridId: b.grid.id,
    x: pos.x,
    y: pos.y,
    z: pos.z,
    w: ext.x,
    l: ext.z,
    h: ext.y,
    rotated: !!dims && ext.x !== dims.w
  }
}

function fromPlacement(b: BayCtx, p: Placement, load: number, drop: number, anchor: boolean): Slot {
  const pos = { x: p.x, y: p.y, z: p.z }
  const ext = { x: p.w, y: p.h, z: p.l }
  const get = (axis: Axis, flip: boolean): { at: number; size: number } => ({
    at: flip ? axisLen(b.grid, axis) - (pos[axis] + ext[axis]) : pos[axis],
    size: ext[axis]
  })
  const c = get(b.cross, b.crossFlip)
  const d = get(b.depth, b.depthFlip)
  const y = get(b.up, b.upFlip)
  return {
    box: p.box,
    bay: b.idx,
    c: c.at,
    d: d.at,
    y: y.at,
    cw: c.size,
    dl: d.size,
    h: y.size,
    load,
    drop,
    stop: anchor ? -1 : p.box.stopIdx,
    anchor
  }
}

const spans = (a0: number, a1: number, b0: number, b1: number): boolean => a0 < b1 && b0 < a1
const cellsClash = (a: Slot, b: Slot): boolean =>
  spans(a.c, a.c + a.cw, b.c, b.c + b.cw) && spans(a.d, a.d + a.dl, b.d, b.d + b.dl) && spans(a.y, a.y + a.h, b.y, b.y + b.h)
const laneClash = (a: Slot, b: Slot): boolean =>
  spans(a.c, a.c + a.cw, b.c, b.c + b.cw) && spans(a.y, a.y + a.h, b.y, b.y + b.h)
const windowsOverlap = (a: Slot, b: Slot): boolean => a.load < b.drop && b.load < a.drop
const containsWindow = (a: Slot, b: Slot): boolean => a.load <= b.load && a.drop >= b.drop

interface Relax {
  build?: boolean
  peel?: boolean
  flank?: boolean
}

// strict legality for one candidate slot: free cells, own-stop support held
// the whole window, row exclusivity, peel order, insertable, no flank pair.
// Mirrors the checks findSpot applies on its strict rung - keep in lockstep.
// A hand-pinned rival only binds physically: it never claims row ownership,
// and in keep mode it doesn't impose lane order either - the user parked it
// there, settled neighbors stay put and any dig cost is theirs to see
function fits(rivals: Slot[], t: Slot, gap: number, aboardAtLoad: Slot[], keep = false): boolean {
  if (rivals.some((r) => cellsClash(t, r))) return false
  if (t.y > 0)
    for (let dc = 0; dc < t.cw; dc++)
      for (let dd = 0; dd < t.dl; dd++) {
        const under = rivals.find(
          (r) =>
            r.y + r.h === t.y &&
            t.c + dc >= r.c && t.c + dc < r.c + r.cw &&
            t.d + dd >= r.d && t.d + dd < r.d + r.dl
        )
        if (
          !under ||
          !(
            under.anchor ||
            ((under.stop === t.stop || under.pinned) && containsWindow(under, t) && under.box.size >= t.box.size)
          )
        )
          return false
      }
  for (const r of rivals) {
    if (!r.anchor && !r.pinned && r.stop !== t.stop && spans(t.d, t.d + t.dl, r.d, r.d + r.dl)) return false
    if (!laneClash(t, r) || (r.pinned && keep)) continue
    const pad = r.stop !== t.stop ? gap : 0
    if (r.drop < t.drop && r.d + r.dl + pad > t.d) return false
    if (r.drop > t.drop && t.d + t.dl + pad > r.d) return false
  }
  if (!canInsert(aboardAtLoad, t)) return false
  if (makesSandwich(rivals, t)) return false
  return true
}

// the v0.5.2 wall builder: first fit scanning depth-ascending, bottom-up,
// then across from the bay's own wall. Long boxes run INTO the bay - the
// whole section is scanned for a depth-stretched fit before the box may
// turn across, which is what draws the long clean lines; turned boxes only
// cap the ends. The final delivery scans from the far wall backward so it
// anchors against the bulkhead
function scanSpot(bay: BayCtx, rivals: Slot[], probe: Slot, gap: number, d0: number, deep: boolean): Slot | null {
  const dims = BOX_DIMS[probe.box.size]
  if (!dims) return null
  if (bay.grid.maxSize && probe.box.size > bay.grid.maxSize) return null
  const aboardAtLoad = rivals.filter((r) => r.load < probe.load && r.drop > probe.load)
  // no footprint swap when the cross axis points at the sky (wall-floored bay)
  const faces: Array<[number, number]> =
    dims.w === dims.l || bay.cross === 'y' ? [[dims.w, dims.l]] : [[dims.w, dims.l], [dims.l, dims.w]]
  // a box that outgrows its stop's section turns across at the cap before
  // poking a lone column deeper - a poke drags full-width row ownership
  // with it and the rows it steals are exactly what the next stop needed
  let ownDeep = d0
  for (const r of rivals) if (!r.anchor && r.stop === probe.stop) ownDeep = Math.max(ownDeep, r.d + r.dl)
  const caps = !deep && ownDeep > d0 && ownDeep < bay.dl ? [ownDeep, bay.dl] : [bay.dl]
  for (const cap of caps)
    for (const [cwf, dlf] of faces)
      for (let i = d0; i < bay.dl; i++) {
        const d = deep ? bay.dl - 1 - (i - d0) : i
        if (d < d0 || d + dlf > cap) continue
        for (let y = 0; y + dims.h <= bay.h; y++)
          for (let cRaw = 0; cRaw < bay.cw; cRaw++) {
            const c = bay.wallHigh ? bay.cw - cRaw - cwf : cRaw
            if (c < 0 || c + cwf > bay.cw) continue
            const t: Slot = { ...probe, bay: bay.idx, c, d, y, cw: cwf, dl: dlf, h: dims.h }
            if (fits(rivals, t, gap, aboardAtLoad)) return t
          }
      }
  return null
}

// slide in at its level, or lower it down an open-topped column: a pit
// between stacks is fine, a spot with cargo overhead is not
function canInsert(aboard: Slot[], t: Slot): boolean {
  if (!aboard.some((r) => laneClash(t, r) && r.d < t.d)) return true
  return !aboard.some(
    (r) => spans(r.c, r.c + r.cw, t.c, t.c + t.cw) && spans(r.d, r.d + r.dl, t.d, t.d + t.dl) && r.y >= t.y + t.h
  )
}

const beats = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

const touches = (a: Slot, b: Slot): boolean => {
  const oc = spans(a.c, a.c + a.cw, b.c, b.c + b.cw)
  const od = spans(a.d, a.d + a.dl, b.d, b.d + b.dl)
  const oy = spans(a.y, a.y + a.h, b.y, b.y + b.h)
  const tc = a.c + a.cw === b.c || b.c + b.cw === a.c
  const td = a.d + a.dl === b.d || b.d + b.dl === a.d
  const ty = a.y + a.h === b.y || b.y + b.h === a.y
  return (tc && od && oy) || (td && oc && oy) || (ty && oc && od)
}

// the game bug: an oppositely-flanked box won't release. Placing t must not
// complete a flank pair around any box that leaves while t is still aboard.
function makesSandwich(rivals: Slot[], t: Slot): boolean {
  const side = (a: Slot, b: Slot, onC: boolean, lo: boolean): boolean => {
    const touch = onC
      ? (lo ? a.c + a.cw === b.c : a.c === b.c + b.cw) && spans(a.d, a.d + a.dl, b.d, b.d + b.dl)
      : (lo ? a.d + a.dl === b.d : a.d === b.d + b.dl) && spans(a.c, a.c + a.cw, b.c, b.c + b.cw)
    return touch && spans(a.y, a.y + a.h, b.y, b.y + b.h)
  }
  for (const r of rivals) {
    if (!r.anchor && r.drop >= t.drop) continue
    for (const onC of [true, false]) {
      const tLo = side(t, r, onC, true)
      const tHi = side(t, r, onC, false)
      if (!tLo && !tHi) continue
      const otherSide = (lo: boolean): boolean =>
        rivals.some((q) => q !== r && (q.anchor || q.drop > r.drop) && side(q, r, onC, lo))
      if ((tLo && (tHi || otherSide(false))) || (tHi && otherSide(true))) return true
    }
  }
  return false
}

// lowest legal resting spot for one box in one bay, or null
function findSpot(
  bay: BayCtx,
  rivals: Slot[],
  probe: Slot,
  cwf: number,
  dlf: number,
  hf: number,
  gap: number,
  relax: Relax,
  zone: number,
  deep?: boolean
): { slot: Slot; key: number[] } | null {
  let best: Slot | null = null
  let bestKey: number[] = new Array(8).fill(Infinity)
  if (bay.grid.maxSize && probe.box.size > bay.grid.maxSize) return null
  const aboardAtLoad = rivals.filter((r) => r.load < probe.load && r.drop > probe.load)
  for (let c = 0; c + cwf <= bay.cw; c++) {
    for (let d = 0; d + dlf <= bay.dl; d++) {
      const t: Slot = { ...probe, bay: bay.idx, c, d, y: 0, cw: cwf, dl: dlf, h: hf }
      const tops = new Set<number>([0])
      for (const r of rivals)
        if (spans(c, c + cwf, r.c, r.c + r.cw) && spans(d, d + dlf, r.d, r.d + r.dl)) tops.add(r.y + r.h)
      for (const y of [...tops].sort((a, b) => a - b)) {
        if (y + hf > bay.h) break
        t.y = y
        if (rivals.some((r) => cellsClash(t, r))) continue
        if (y > 0) {
          // rests only on its own stop's boxes (or anchors), held the whole
          // window, and never on a smaller box - biggest bottom is literal;
          // different stops never stack on each other
          let held = true
          for (let dc = 0; dc < cwf && held; dc++)
            for (let dd = 0; dd < dlf && held; dd++) {
              const under = rivals.find(
                (r) =>
                  r.y + r.h === y &&
                  c + dc >= r.c && c + dc < r.c + r.cw &&
                  d + dd >= r.d && d + dd < r.d + r.dl
              )
              if (
                !under ||
                !(
                  under.anchor ||
                  ((under.stop === t.stop || under.pinned) && containsWindow(under, t) && under.box.size >= t.box.size)
                )
              )
                held = false
            }
          if (!held) continue
        }
        let ok = true
        if (!relax.peel)
          for (const r of rivals) {
            // a depth row belongs to one stop wall-to-wall; no crossing another bucket's rows
            if (!r.anchor && !r.pinned && r.stop !== t.stop && spans(t.d, t.d + t.dl, r.d, r.d + r.dl)) {
              ok = false
              break
            }
            if (!laneClash(t, r)) continue
            const pad = r.stop !== t.stop ? gap : 0
            // earlier drop peels first, so it sits nearer the exit
            if (r.drop < t.drop && r.d + r.dl + pad > t.d) { ok = false; break }
            if (r.drop > t.drop && t.d + t.dl + pad > r.d) { ok = false; break }
          }
        if (ok && !relax.build && !canInsert(aboardAtLoad, t)) ok = false
        if (ok && !relax.build && !relax.flank && makesSandwich(rivals, t)) ok = false
        if (!ok) continue
        // in the depth zone, glued to own stop, stack HIGH before claiming new
        // floor (floor is the scarce resource), low, shallow. Orientation is a
        // tiebreak at equal depth: stretch across, but a rotated box that fills
        // the current row beats an across box opening a new one
        let contacts = 0
        for (const r of rivals) if (r.stop === t.stop && touches(t, r)) contacts++
        const glued = contacts ? 0 : 1
        // perching smalls keep off the wall-side tops: that's where the next
        // unit's tall column lands, and a squatter there shoves it off line
        const hugHigh = cwf * dlf <= 4 && y > 0 ? !bay.wallHigh : bay.wallHigh
        const cWall = hugHigh ? bay.cw - (t.c + cwf) : t.c
        // the run's final delivery anchors at the far wall: nothing ever
        // loads behind it, so shallow-packing would strand it mid-bay
        const dKey = deep ? bay.dl - (t.d + dlf) : t.d
        // small boxes nestle before edging: more own-stop faces touched beats
        // a spot at the rim, and kissing the hull counts once a box is
        // already nestling. Bigger boxes keep pure geometry - contact-chasing
        // there walls off space and costs the route real trips
        const wallKiss = (bay.wallHigh ? t.c + cwf === bay.cw : t.c === 0) ? 1 : 0
        const snug = probe.box.size <= 4 && contacts ? -(contacts + wallKiss) : 0
        const key = [t.d >= zone ? 0 : 1, glued, y === 0 ? cwf * dlf : 0, t.y, dKey, dlf, snug, cWall]
        if (beats(key, bestKey)) {
          best = { ...t }
          bestKey = key
        }
        break
      }
    }
  }
  return best ? { slot: best, key: bestKey } : null
}

const unitOrder = (a: PackBox, b: PackBox): number =>
  b.size - a.size || (a.bucketId ?? '').localeCompare(b.bucketId ?? '')

function bestFace(
  bay: BayCtx,
  rivals: Slot[],
  probe: Slot,
  gap: number,
  relax: Relax,
  deep?: boolean
): { slot: Slot; key: number[] } | null {
  const dims = BOX_DIMS[probe.box.size]
  if (!dims) return null
  // the unit's reserved depth zone starts past every co-aboard earlier delivery
  let zone = 0
  for (const s of rivals) if (!s.anchor && s.drop < probe.drop) zone = Math.max(zone, s.d + s.dl)
  // a wall-floored bay's cross axis points at the sky: a footprint swap there
  // stands the box on end, so the long side stays on the level depth axis
  const faces: Array<[number, number]> =
    dims.w === dims.l || bay.cross === 'y' ? [[dims.w, dims.l]] : [[dims.w, dims.l], [dims.l, dims.w]]
  let best: { slot: Slot; key: number[] } | null = null
  for (const [cwf, dlf] of faces) {
    const s = findSpot(bay, rivals, probe, cwf, dlf, dims.h, gap, relax, zone, deep)
    if (s && (!best || beats(s.key, best.key))) best = s
  }
  return best
}

function seatBoxes(
  cfg: BayCtx[],
  slots: Slot[],
  unit: PackBox[],
  load: number,
  drop: number,
  gap: number,
  deep?: boolean
): Slot[] | null {
  const placed: Slot[] = []
  for (const box of [...unit].sort(unitOrder)) {
    const probe: Slot = { box, bay: -1, c: 0, d: 0, y: 0, cw: 0, dl: 0, h: 0, load, drop, stop: box.stopIdx, anchor: false }
    // best spot across every permitted bay, not the first bay with any spot:
    // a spilled box would rather glue to its stack next door than squat in
    // an empty pocket here
    let got: { slot: Slot; key: number[] } | null = null
    for (const bay of cfg) {
      const rivals = slots.concat(placed).filter((s) => s.bay === bay.idx && windowsOverlap(s, probe))
      const s = bestFace(bay, rivals, probe, gap, {}, deep)
      if (s && (!got || beats(s.key, got.key))) got = s
    }
    if (!got) return null
    placed.push(got.slot)
  }
  return placed
}

// whole unit into one bay set, no concessions. Seat once to pick the bay and
// find the section start, then rebuild it with the wall scanner so the block
// comes out as solid full-width slices
function seatUnit(
  cfg: BayCtx[],
  slots: Slot[],
  unit: PackBox[],
  load: number,
  drop: number,
  gap: number,
  shaping: boolean,
  deep: boolean
): Slot[] | null {
  const first = seatBoxes(cfg, slots, unit, load, drop, gap, deep)
  if (!first || !shaping) return first
  // rebuild each bay's share with the wall scanner; a stop's later pickups
  // continue the section its first pickup started, plugging its leftover
  // holes instead of opening a fresh wall beside it
  const byBay = new Map<number, PackBox[]>()
  for (const s of first) (byBay.get(s.bay) ?? byBay.set(s.bay, []).get(s.bay)!).push(s.box)
  const placed: Slot[] = []
  for (const [bayIdx, subset] of byBay) {
    const bay = cfg.find((b) => b.idx === bayIdx)!
    let d0 = Math.min(...first.filter((s) => s.bay === bayIdx).map((s) => s.d))
    for (const s of slots) if (s.bay === bayIdx && !s.anchor && s.stop === unit[0].stopIdx) d0 = Math.min(d0, s.d)
    for (const box of [...subset].sort(unitOrder)) {
      const probe: Slot = { box, bay: -1, c: 0, d: 0, y: 0, cw: 0, dl: 0, h: 0, load, drop, stop: box.stopIdx, anchor: false }
      const rivals = slots.concat(placed).filter((s) => s.bay === bayIdx && windowsOverlap(s, probe))
      const got = scanSpot(bay, rivals, probe, gap, d0, deep)
      if (!got) return first
      placed.push(got)
    }
  }
  return placed
}

// per-box escalation: clean spot anywhere, then out-of-order, then buried
function seatConceding(
  bays: BayCtx[],
  open: BayCtx[],
  slots: Slot[],
  unit: PackBox[],
  load: number,
  drop: number,
  gap: number,
  shaping: boolean,
  deep: boolean
): { placed: Slot[]; conceded: Concession[]; failed: PackBox[] } {
  const rungs: Array<{ gap: number; relax: Relax; kind?: Concession['kind'] }> = [
    { gap, relax: {} },
    ...(gap > 0 ? [{ gap: 0, relax: {} }] : []),
    { gap: 0, relax: { peel: true }, kind: 'peel' as const },
    { gap: 0, relax: { peel: true, flank: true }, kind: 'flank' as const },
    { gap: 0, relax: { peel: true, flank: true, build: true }, kind: 'build' as const }
  ]
  const placed: Slot[] = []
  const conceded: Concession[] = []
  const failed: PackBox[] = []
  const strict = rungs.filter((r) => !r.kind)
  const lift = rungs.filter((r) => r.kind === 'peel')
  const pin = rungs.filter((r) => r.kind === 'flank')
  const dig = rungs.filter((r) => r.kind === 'build')
  const stop = unit[0].stopIdx
  // keep a stop's cargo together: bays already holding this stop come first
  const affinity = (list: BayCtx[]): BayCtx[] => {
    const has = (b: BayCtx): boolean => slots.some((s) => s.bay === b.idx && s.stop === stop)
    return list.filter(has).concat(list.filter((b) => !has(b)))
  }
  for (const box of [...unit].sort(unitOrder)) {
    const probe: Slot = { box, bay: -1, c: 0, d: 0, y: 0, cw: 0, dl: 0, h: 0, load, drop, stop: box.stopIdx, anchor: false }
    let got: Slot | null = null
    let kind: Concession['kind'] | undefined
    const attempt = (bayList: BayCtx[], rungList: typeof rungs): boolean => {
      for (const rung of rungList)
        for (const bay of bayList) {
          const rivals = slots.concat(placed).filter((s) => s.bay === bay.idx && windowsOverlap(s, probe))
          // the scanner visits every cell, so on the strict rung it finds a
          // spot whenever one exists - shaped passes use it here too so a
          // bucket too big for any bay still comes out as long lines. The
          // final delivery keeps its bulkhead anchor even here: a mega
          // bucket packing shallow floods the fronts everyone after it
          // needs. Deep stays off the relaxed rungs - forcing it there made
          // a near-full hold trade real placements for the anchor
          const s =
            shaping && !rung.kind
              ? scanSpot(bay, rivals, probe, rung.gap, 0, deep)
              : bestFace(bay, rivals, probe, rung.gap, rung.relax)?.slot ?? null
          if (s) {
            got = s
            kind = rung.kind
            if (!open.includes(bay)) open.push(bay)
            return true
          }
        }
      return false
    }
    const order = (): BayCtx[] => affinity(open).concat(bays.filter((b) => !open.includes(b)))
    attempt(order(), strict) || attempt(order(), lift) || attempt(order(), pin) || attempt(order(), dig)
    if (!got) {
      failed.push(box)
      continue
    }
    placed.push(got)
    if (kind) conceded.push({ boxId: box.id, kind })
  }
  return { placed, conceded, failed }
}

interface Strand {
  id: string
  blockers: string[]
}

// can this drop set physically come out, given the flanking bug;
// a stop unloads before it loads, so same-step pickups aren't in the way
function extractIssues(slots: Slot[], step: number): Strand[] {
  const aboard = slots.filter((s) => s.load < step && s.drop > step)
  const leaving = slots.filter((s) => s.drop === step)
  const out = new Set<Slot>()
  const present = (): Slot[] => aboard.concat(leaving).filter((s) => !out.has(s))
  const whyStuck = (r: Slot, others: Slot[]): string[] | null => {
    const blockers = new Set<string>()
    if (others.some((q) => laneClash(q, r) && q.d < r.d)) {
      // blocked at its level; lifts out the open top unless something hangs over it
      const overCol = others.filter(
        (q) => spans(q.c, q.c + q.cw, r.c, r.c + r.cw) && spans(q.d, q.d + q.dl, r.d, r.d + r.dl) && q.y >= r.y + r.h
      )
      if (overCol.length) {
        for (const q of overCol) blockers.add(q.box.id)
        for (const q of others) if (spans(q.c, q.c + q.cw, r.c, r.c + r.cw) && q.d < r.d) blockers.add(q.box.id)
      }
    }
    for (const q of others)
      if (q.y === r.y + r.h && spans(q.c, q.c + q.cw, r.c, r.c + r.cw) && spans(q.d, q.d + q.dl, r.d, r.d + r.dl))
        blockers.add(q.box.id)
    const besides = (lo: boolean, onC: boolean): Slot[] =>
      others.filter((q) => {
        const touch = onC
          ? (lo ? q.c + q.cw === r.c : q.c === r.c + r.cw) && spans(q.d, q.d + q.dl, r.d, r.d + r.dl)
          : (lo ? q.d + q.dl === r.d : q.d === r.d + r.dl) && spans(q.c, q.c + q.cw, r.c, r.c + r.cw)
        return touch && spans(q.y, q.y + q.h, r.y, r.y + r.h)
      })
    for (const onC of [true, false]) {
      const lo = besides(true, onC)
      const hi = besides(false, onC)
      if (lo.length && hi.length) for (const q of lo.concat(hi)) blockers.add(q.box.id)
    }
    return blockers.size ? [...blockers] : null
  }
  for (;;) {
    const rest = leaving.filter((s) => !out.has(s))
    if (!rest.length) return []
    let moved = false
    const strands: Strand[] = []
    for (const r of rest) {
      const others = present().filter((q) => q !== r && q.bay === r.bay)
      const why = whyStuck(r, others)
      if (!why) {
        out.add(r)
        moved = true
        break
      }
      strands.push({ id: r.box.id, blockers: why })
    }
    if (!moved) return strands
  }
}

// Live fit oracle for the route walk. Cargo placed at pickup stays put;
// deliveries free real space. Answers use the same physics as planHold but
// only clean and lift-tier placements, so "won't fit" nudges the walk to
// deliver first and come back rather than plan a dig.
export interface OracleJob {
  id: number
  dest: number
  boxes: number[]
}

export interface HoldOracle {
  canTake(jobs: OracleJob[], rankOf: (dest: number) => number, dropping?: ReadonlySet<number>): boolean
  /** joinPrev keeps this take on the same stop as the previous one */
  take(jobs: OracleJob[], rankOf: (dest: number) => number, joinPrev?: boolean): boolean
  release(jobIds: number[]): void
}

const FUT = 1 << 20

export function holdOracle(grids: CargoGrid[]): HoldOracle {
  const bays = grids.filter((g) => g.autoLoad !== false).map((g, i) => bayCtx(g, i))
  let slots: Slot[] = []
  const byJob = new Map<number, Slot[]>()
  let seq = 0
  const rungs: Array<{ gap: number; relax: Relax }> = [{ gap: 0, relax: {} }, { gap: 0, relax: { peel: true } }]

  const placeAll = (
    jobs: OracleJob[],
    rankOf: (dest: number) => number,
    dropping?: ReadonlySet<number>
  ): Slot[][] | null => {
    const gone = new Set<Slot>()
    if (dropping) for (const id of dropping) for (const s of byJob.get(id) ?? []) gone.add(s)
    const work = slots.filter((s) => !gone.has(s))
    for (const s of work) s.drop = FUT + rankOf(s.stop)
    const placed: Slot[][] = []
    for (const job of jobs) {
      const mine: Slot[] = []
      const sizes = [...job.boxes].sort((a, b) => b - a)
      for (let k = 0; k < sizes.length; k++) {
        const box: PackBox = { id: `o${job.id}#${k}`, size: sizes[k], color: '', dest: '', stopIdx: job.dest }
        const probe: Slot = {
          box, bay: -1, c: 0, d: 0, y: 0, cw: 0, dl: 0, h: 0,
          load: seq, drop: FUT + rankOf(job.dest), stop: job.dest, anchor: false
        }
        let got: Slot | null = null
        outer: for (const rung of rungs)
          for (const bay of bays) {
            const rivals = work.filter((s) => s.bay === bay.idx && windowsOverlap(s, probe))
            got = bestFace(bay, rivals, probe, rung.gap, rung.relax)?.slot ?? null
            if (got) break outer
          }
        if (!got) return null
        work.push(got)
        mine.push(got)
      }
      placed.push(mine)
    }
    return placed
  }

  return {
    canTake: (jobs, rankOf, dropping) => placeAll(jobs, rankOf, dropping) !== null,
    take(jobs, rankOf, joinPrev) {
      const placed = placeAll(jobs, rankOf)
      if (!placed) return false
      if (!joinPrev) seq++
      jobs.forEach((job, i) => {
        byJob.set(job.id, placed[i])
        slots.push(...placed[i])
      })
      return true
    },
    release(jobIds) {
      const gone = new Set<Slot>()
      for (const id of jobIds) {
        for (const s of byJob.get(id) ?? []) gone.add(s)
        byJob.delete(id)
      }
      slots = slots.filter((s) => !gone.has(s))
    }
  }
}

export function planHold(grids: CargoGrid[], events: LoadEvent[], opts: HoldOpts = {}): HoldPlan {
  const { loose, pins, prev, gap = 0, frames } = opts
  const openable = grids.filter((g) => g.autoLoad !== false)
  const bays = openable.map((g, i) => bayCtx(g, i, frames?.get(g.id)))
  const bayById = new Map(bays.map((b) => [b.grid.id, b]))

  const boxOf = new Map<string, PackBox>()
  for (const ev of events) for (const b of ev.load) boxOf.set(b.id, b)
  const loadAt = new Map<string, number>()
  const dropAt = new Map<string, number>()
  events.forEach((ev, i) => {
    for (const b of ev.load) if (!loadAt.has(b.id)) loadAt.set(b.id, i)
    for (const id of ev.drop) if (loadAt.has(id) && !dropAt.has(id)) dropAt.set(id, i)
  })
  const loadOf = (id: string): number => loadAt.get(id) ?? 0
  const dropOf = (id: string): number => dropAt.get(id) ?? events.length

  const units = new Map<string, PackBox[]>()
  for (const b of boxOf.values()) {
    if (loose?.has(b.id) || pins?.has(b.id)) continue
    const key = `${b.stopIdx}@${loadOf(b.id)}`
    ;(units.get(key) ?? units.set(key, []).get(key)!).push(b)
  }
  // earliest deliveries claim the shallow space first
  const ordered = [...units.values()].sort(
    (a, b) => dropOf(a[0].id) - dropOf(b[0].id) || loadOf(a[0].id) - loadOf(b[0].id)
  )
  const lastDrop = ordered.length ? dropOf(ordered[ordered.length - 1][0].id) : -1

  interface PassResult {
    slots: Slot[]
    byBox: Map<string, Slot>
    verdicts: UnitVerdict[]
    concessions: Concession[]
    kept: Set<string>
  }
  const runPass = (queue: PackBox[][], shaping: boolean): PassResult => {
    const slots: Slot[] = []
    const byBox = new Map<string, Slot>()
    const kept = new Set<string>()
    if (pins)
      for (const [id, p] of pins) {
        const bay = bayById.get(p.gridId)
        if (!bay) continue
        const box = boxOf.get(id) ?? p.box
        const s = fromPlacement(bay, { ...p, box }, boxOf.has(id) ? loadOf(id) : 0, boxOf.has(id) ? dropOf(id) : NEVER, !boxOf.has(id))
        if (!s.anchor) s.pinned = true
        slots.push(s)
        byBox.set(box.id, s)
      }
    const open: BayCtx[] = []
    const verdicts: UnitVerdict[] = []
    const concessions: Concession[] = []
    for (const unit of queue) {
      const load = loadOf(unit[0].id)
      const drop = dropOf(unit[0].id)
      const stop = unit[0].stopIdx
      const deep = drop === lastDrop
      // a box that still fits the spot the previous plan gave it keeps it;
      // only displaced boxes re-seat, so the layout the user saw stays put
      let rest = unit
      if (prev) {
        rest = []
        // floor first: a kept box's supporter must already be back in place
        // before the support check runs
        for (const box of [...unit].sort((a, b) => (prev.get(a.id)?.y ?? 0) - (prev.get(b.id)?.y ?? 0))) {
          const pl = prev.get(box.id)
          const bay = pl ? bayById.get(pl.gridId) : undefined
          if (pl && bay) {
            const t = fromPlacement(bay, { ...pl, box }, load, drop, false)
            const rivals = slots.filter((s) => s.bay === bay.idx && windowsOverlap(s, t))
            const support = rivals.filter((r) => r.load < load && r.drop > load)
            let seat: Slot | null = fits(rivals, t, gap, support, true) ? t : null
            // its supporter left: settle straight down in its own column
            // before the ladder gets to fling it somewhere fresh
            for (let y = 0; !seat && y < t.y; y++) {
              const s2 = { ...t, y }
              if (fits(rivals, s2, gap, support, true)) seat = s2
            }
            if (seat) {
              slots.push(seat)
              byBox.set(box.id, seat)
              kept.add(box.id)
              continue
            }
          }
          rest.push(box)
        }
        if (!rest.length) {
          verdicts.push({ stop, load, ok: true, boxes: unit })
          continue
        }
      }
      // whole unit clean in one bay, then a fresh bay, then spilled, then per-box
      // concessions. Bays holding this stop's pinned or kept cargo count as homes
      // even before any unit opened them
      const has = (b: BayCtx): boolean => slots.some((s) => s.bay === b.idx && s.stop === stop)
      const homes = open
        .filter(has)
        .concat(bays.filter((b) => !open.includes(b) && has(b)))
        .concat(open.filter((b) => !has(b)))
      let placed: Slot[] | null = null
      for (const b of homes) if ((placed = seatUnit([b], slots, rest, load, drop, gap, shaping, deep))) break
      if (!placed) {
        // the final delivery opens the smallest bay that takes it whole:
        // a handful of last-drop boxes claiming the big bay's bulkhead rows
        // starves the mid-run stop that needed exactly that depth
        const fresh = bays.filter((b) => !open.includes(b))
        if (deep) fresh.sort((a, b) => a.cw * a.dl * a.h - b.cw * b.dl * b.h)
        for (const next of deep ? fresh : fresh.slice(0, 1))
          if ((placed = seatUnit([next], slots, rest, load, drop, gap, shaping, deep))) {
            open.push(next)
            break
          }
      }
      if (!placed) placed = seatUnit(open, slots, rest, load, drop, gap, shaping, deep)
      if (placed) {
        slots.push(...placed)
        for (const s of placed) byBox.set(s.box.id, s)
        verdicts.push({ stop, load, ok: true, boxes: unit })
      } else {
        const got = seatConceding(bays, open, slots, rest, load, drop, gap, shaping, deep)
        slots.push(...got.placed)
        for (const s of got.placed) byBox.set(s.box.id, s)
        concessions.push(...got.conceded)
        if (got.failed.length) verdicts.push({ stop, load, ok: false, boxes: got.failed, reason: 'space' })
        else verdicts.push({ stop, load, ok: true, boxes: unit })
      }
    }
    return { slots, byBox, verdicts, concessions, kept }
  }

  const homeless = (p: PassResult): number => p.verdicts.reduce((a, v) => a + (v.ok ? 0 : v.boxes.length), 0)
  // the most window-constrained cargo shouldn't go last: on any homeless
  // boxes, retry once with their units placed first
  const solve = (shaping: boolean): PassResult => {
    let pass = runPass(ordered, shaping)
    if (pass.verdicts.some((v) => !v.ok)) {
      const failedKeys = new Set(pass.verdicts.filter((v) => !v.ok).map((v) => `${v.stop}@${v.load}`))
      const promoted = ordered
        .filter((u) => failedKeys.has(`${u[0].stopIdx}@${loadOf(u[0].id)}`))
        .concat(ordered.filter((u) => !failedKeys.has(`${u[0].stopIdx}@${loadOf(u[0].id)}`)))
      const retry = runPass(promoted, shaping)
      if (
        homeless(retry) < homeless(pass) ||
        (homeless(retry) === homeless(pass) && retry.concessions.length < pass.concessions.length)
      )
        pass = retry
    }
    return pass
  }

  // neat shapes when they're free; a near-full hold keeps whichever world
  // owes fewer concessions, and once boxes are homeless the flat world also
  // takes ties - shapes have no business winning under that kind of pressure
  let pass = solve(true)
  let shapedWon = true
  if (homeless(pass) || pass.concessions.length) {
    const flat = solve(false)
    const h = homeless(pass) - homeless(flat)
    if (
      h > 0 ||
      (h === 0 &&
        (homeless(pass) > 0
          ? flat.concessions.length <= pass.concessions.length
          : flat.concessions.length < pass.concessions.length))
    ) {
      pass = flat
      shapedWon = false
    }
  }

  // a stop smeared across bays pulls its strays back to its main bay when
  // they all fit there cleanly; anything resting on a stray is the same
  // stop's cargo, so the whole group moves or none of it does. In the
  // shaped world the strays re-seat through the wall scanner so they
  // continue the stop's section instead of landing as a rank-shaped tower.
  // When the strays miss, each squatter group in the main bay gets a shot
  // at re-homing whole into another bay first: short-stay cargo parked in
  // the front rows early poisons whole-run cells by a hair, and evicting
  // it is a solver-time move like any other
  const reunite = (p: PassResult, shaped: boolean): Set<string> => {
    const moved = new Set<string>()
    const nailed = (id: string): boolean => (pins?.has(id) ?? false) || p.kept.has(id)
    const byStop = new Map<number, Slot[]>()
    for (const s of p.slots)
      if (!s.anchor)
        (byStop.get(s.stop) ?? byStop.set(s.stop, []).get(s.stop)!).push(s)
    const seatIn = (s: Slot, bayIdx: number): Slot | null => {
      const rivals = p.slots.filter((q) => q !== s && q.bay === bayIdx && windowsOverlap(q, s))
      const probe: Slot = { ...s, bay: -1, c: 0, d: 0, y: 0, cw: 0, dl: 0, h: 0 }
      if (!shaped) return bestFace(bays[bayIdx], rivals, probe, gap, {})?.slot ?? null
      let d0 = Infinity
      for (const q of p.slots)
        if (q !== s && q.bay === bayIdx && !q.anchor && q.stop === s.stop) d0 = Math.min(d0, q.d)
      const start = isFinite(d0) ? d0 : 0
      const deep = s.drop === lastDrop
      const got = scanSpot(bays[bayIdx], rivals, probe, gap, start, deep)
      // the family can also grow toward the door: rows in front of its
      // section freed by a delivery are fair game when the section is full
      return got ?? (start > 0 ? scanSpot(bays[bayIdx], rivals, probe, gap, 0, deep) : null)
    }
    const moveAll = (list: Slot[], bayIdx: number): Slot[] | null => {
      const saved = list.map((s) => ({ ...s }))
      // bigs claim their columns before smalls eat the floor, and within a
      // size the earliest load goes first so stacking chains stay legal
      // (a box only rests on cargo aboard for its whole window)
      for (const s of [...list].sort((a, b) => b.box.size - a.box.size || a.load - b.load)) {
        const slot = seatIn(s, bayIdx)
        if (!slot) {
          list.forEach((x, i) => Object.assign(x, saved[i]))
          return null
        }
        Object.assign(s, slot)
      }
      return saved
    }
    // earlier deliveries reunite first, same as they seat: a late stop's
    // eviction needs the bays the early stops have already tidied. Pins
    // land in the slot list ahead of everything, so insertion order would
    // put a pinned stop at the front and starve its eviction
    const groups = [...byStop.values()].sort((a, b) => a[0].drop - b[0].drop || a[0].stop - b[0].stop)
    for (const group of groups) {
      const count = new Map<number, number>()
      for (const s of group) count.set(s.bay, (count.get(s.bay) ?? 0) + 1)
      if (count.size < 2) continue
      const scu = group.reduce((a, s) => a + s.box.size, 0)
      // pinned and kept cargo is nailed down: it can't move, but it still
      // votes - only a bay holding every nailed box can be the family's home
      const nailedBays = new Set(group.filter((s) => nailed(s.box.id)).map((s) => s.bay))
      if (nailedBays.size > 1) continue
      // consolidation target: its biggest cluster's bay first, then the rest;
      // a bay the whole family can't even volume-fit isn't worth a scan
      const targets = [...count.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([i]) => i)
        .concat(bays.map((b) => b.idx).filter((i) => !count.has(i)))
        .filter((i) => (!nailedBays.size || nailedBays.has(i)) && scu <= bays[i].cw * bays[i].dl * bays[i].h)
      let done = false
      for (const homeIdx of targets) {
        const strays = group.filter((s) => s.bay !== homeIdx && !nailed(s.box.id))
        if (moveAll(strays, homeIdx)) {
          for (const s of strays) moved.add(s.box.id)
          done = true
          break
        }
        // a single short-stay unit squatting the target bay can poison
        // whole-window rows by a hair; give each one a shot at re-homing
        // whole into another bay, then try the strays again
        const units = new Map<string, Slot[]>()
        for (const q of p.slots)
          if (!q.anchor && !nailed(q.box.id) && q.bay === homeIdx && q.stop !== group[0].stop)
            (units.get(`${q.stop}@${q.load}`) ?? units.set(`${q.stop}@${q.load}`, []).get(`${q.stop}@${q.load}`)!).push(q)
        evict: for (const qs of [...units.values()].sort((a, b) => a.length - b.length).slice(0, 8)) {
          for (const t of bays) {
            if (t.idx === homeIdx) continue
            const savedQ = moveAll(qs, t.idx)
            if (!savedQ) continue
            if (moveAll(strays, homeIdx)) {
              for (const s of strays) moved.add(s.box.id)
              for (const q of qs) moved.add(q.box.id)
              done = true
              break evict
            }
            qs.forEach((x, i) => Object.assign(x, savedQ[i]))
          }
        }
        if (done) break
      }
    }
    return moved
  }
  const movedIds = reunite(pass, shapedWon)

  // a tiny box seated before its family arrived may sit at the rim of what
  // became a hole; re-nestle it against the finished layout (solver-time
  // move, its permanent slot just improves before anyone sees the plan)
  const tidyTiny = (p: PassResult): void => {
    const contactsOf = (t: Slot, rivals: Slot[]): number => {
      let n = 0
      for (const r of rivals) if (r.stop === t.stop && touches(t, r)) n++
      if (!n) return 0
      const b = bays[t.bay]
      return n + ((b.wallHigh ? t.c + t.cw === b.cw : t.c === 0) ? 1 : 0)
    }
    const tiny = p.slots
      .filter((s) => !s.anchor && !pins?.has(s.box.id) && !p.kept.has(s.box.id) && s.box.size <= 4)
      .sort((a, b) => b.box.size - a.box.size)
    for (const s of tiny) {
      const rider = p.slots.some(
        (q) =>
          q !== s && q.bay === s.bay && windowsOverlap(q, s) && q.y === s.y + s.h &&
          spans(q.c, q.c + q.cw, s.c, s.c + s.cw) && spans(q.d, q.d + q.dl, s.d, s.d + s.dl)
      )
      if (rider) continue
      const rivals = p.slots.filter((q) => q !== s && q.bay === s.bay && windowsOverlap(q, s))
      const got = bestFace(bays[s.bay], rivals, { ...s, bay: -1, c: 0, d: 0, y: 0, cw: 0, dl: 0, h: 0 }, gap, {})
      // this pass exists only to nestle: move on a strict contact gain,
      // never sideways into a spot the key likes but the eye doesn't
      if (got && contactsOf(got.slot, rivals) > contactsOf(s, rivals)) Object.assign(s, got.slot)
    }
  }
  tidyTiny(pass)

  // pins are immovable in c/d, but gravity still applies: dragging the box
  // out from under a hand-placed (or loaded) stack must not leave it hanging.
  // The floating pin and everything resting on it fall together, straight
  // down, onto the nearest legal support
  const settlePins = (p: PassResult): void => {
    const holds = (r: Slot, t: Slot): boolean =>
      r.anchor || ((r.stop === t.stop || !!r.pinned) && containsWindow(r, t) && r.box.size >= t.box.size)
    const seated = (rivals: Slot[], t: Slot, atY: number): boolean => {
      if (atY === 0) return true
      for (let dc = 0; dc < t.cw; dc++)
        for (let dd = 0; dd < t.dl; dd++) {
          const under = rivals.find(
            (r) =>
              r.y + r.h === atY &&
              t.c + dc >= r.c && t.c + dc < r.c + r.cw &&
              t.d + dd >= r.d && t.d + dd < r.d + r.dl
          )
          if (!under || !holds(under, t)) return false
        }
      return true
    }
    for (const s of [...p.slots].sort((a, b) => a.y - b.y)) {
      if (!s.pinned || s.anchor || s.y === 0) continue
      const rivals = p.slots.filter((q) => q !== s && q.bay === s.bay && windowsOverlap(q, s))
      if (seated(rivals, s, s.y)) continue
      const tower: Slot[] = [s]
      for (let grew = true; grew; ) {
        grew = false
        for (const q of p.slots) {
          if (tower.includes(q) || q.anchor || q.bay !== s.bay) continue
          const riding = tower.some(
            (t) =>
              q.y === t.y + t.h && windowsOverlap(q, t) &&
              spans(q.c, q.c + q.cw, t.c, t.c + t.cw) && spans(q.d, q.d + q.dl, t.d, t.d + t.dl)
          )
          if (riding) {
            tower.push(q)
            grew = true
          }
        }
      }
      const rest = new Set(tower)
      let delta = Infinity
      for (const t of tower) {
        const others = p.slots.filter((q) => !rest.has(q) && q.bay === t.bay && windowsOverlap(q, t))
        let top = 0
        for (const r of others)
          if (r.y + r.h <= t.y && holds(r, t) &&
              spans(r.c, r.c + r.cw, t.c, t.c + t.cw) && spans(r.d, r.d + r.dl, t.d, t.d + t.dl))
            top = Math.max(top, r.y + r.h)
        delta = Math.min(delta, t.y - top)
      }
      if (!isFinite(delta) || delta <= 0) continue
      const landing = tower.every((t) => {
        const others = p.slots.filter((q) => !rest.has(q) && q.bay === t.bay && windowsOverlap(q, t))
        const probe = { ...t, y: t.y - delta }
        return !others.some((q) => cellsClash(probe, q)) && seated(others, probe, probe.y)
      })
      if (landing) for (const t of tower) t.y -= delta
    }
  }
  settlePins(pass)

  const { slots, byBox, verdicts } = pass
  const concessions = pass.concessions.filter((c) => !movedIds.has(c.boxId))

  const snaps: LoadSnap[] = []
  for (let i = 0; i < events.length; i++) {
    const placements: Placement[] = []
    const unplaced: PackBox[] = []
    const looseNow: PackBox[] = []
    for (const box of boxOf.values()) {
      if (loadOf(box.id) > i || dropOf(box.id) <= i) continue
      if (loose?.has(box.id)) looseNow.push(box)
      else {
        const s = byBox.get(box.id)
        if (s) placements.push(toPlacement(bays[s.bay], s))
        else unplaced.push(box)
      }
    }
    snaps.push({ placements, unplaced, loose: looseNow })
  }

  const issues: string[] = []
  const conceded = new Set(concessions.map((c) => c.boxId))
  const dropSteps = new Set<number>()
  for (const s of slots) if (!s.anchor && s.drop < NEVER && s.drop < events.length) dropSteps.add(s.drop)
  let extractOk = true
  for (const step of dropSteps) {
    const stuck = extractIssues(slots, step).filter(
      (st) => !conceded.has(st.id) && !st.blockers.some((b) => conceded.has(b))
    )
    if (stuck.length) {
      extractOk = false
      issues.push(`step ${step}: ${stuck.length} box(es) stuck: ${stuck.slice(0, 4).map((s) => s.id).join(', ')}`)
    }
  }
  let buildOk = true
  for (const s of slots) {
    if (s.anchor || conceded.has(s.box.id)) continue
    const aboard = slots.filter((q) => q !== s && q.bay === s.bay && q.load < s.load && q.drop > s.load)
    if (!canInsert(aboard, s)) {
      buildOk = false
      issues.push(`box ${s.box.id} loads behind cargo already aboard`)
    }
  }
  let floatOk = true
  for (const s of slots) {
    if (s.y === 0 || s.anchor) continue
    for (let dc = 0; dc < s.cw && floatOk; dc++)
      for (let dd = 0; dd < s.dl && floatOk; dd++) {
        const under = slots.find(
          (q) =>
            q.bay === s.bay && q.y + q.h === s.y &&
            s.c + dc >= q.c && s.c + dc < q.c + q.cw &&
            s.d + dd >= q.d && s.d + dd < q.d + q.dl &&
            (q.anchor || ((q.stop === s.stop || q.pinned) && containsWindow(q, s)))
        )
        if (!under) {
          floatOk = false
          issues.push(`box ${s.box.id} floats at y=${s.y}`)
        }
      }
  }

  return { snaps, verdicts, concessions, proofs: { floatOk, buildOk, extractOk, issues } }
}
