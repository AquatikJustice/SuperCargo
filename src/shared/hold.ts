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
}

export interface HoldOpts {
  loose?: ReadonlySet<string>
  pins?: ReadonlyMap<string, Placement>
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

// bay-local frame: d runs exit-inward, c across, y up
interface BayCtx {
  idx: number
  grid: CargoGrid
  cw: number
  dl: number
  h: number
  onZ: boolean
  dir: -1 | 1
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
}

function bayCtx(grid: CargoGrid, idx: number, frame?: Frame): BayCtx {
  const exit = frame?.exit ?? grid.exit ?? { axis: 'z' as const, dir: -1 as const }
  const onZ = exit.axis === 'z'
  return {
    idx,
    grid,
    cw: onZ ? grid.w : grid.l,
    dl: onZ ? grid.l : grid.w,
    h: grid.h,
    onZ,
    dir: exit.dir
  }
}

function toPlacement(b: BayCtx, s: Slot): Placement {
  const dims = BOX_DIMS[s.box.size]
  const x = b.onZ ? s.c : b.dir === -1 ? s.d : b.grid.w - (s.d + s.dl)
  const z = b.onZ ? (b.dir === -1 ? s.d : b.grid.l - (s.d + s.dl)) : s.c
  const w = b.onZ ? s.cw : s.dl
  const l = b.onZ ? s.dl : s.cw
  return { box: s.box, gridId: b.grid.id, x, y: s.y, z, w, l, h: s.h, rotated: !!dims && w !== dims.w }
}

function fromPlacement(b: BayCtx, p: Placement, load: number, drop: number, anchor: boolean): Slot {
  const d = b.onZ ? (b.dir === -1 ? p.z : b.grid.l - (p.z + p.l)) : b.dir === -1 ? p.x : b.grid.w - (p.x + p.w)
  const c = b.onZ ? p.x : p.z
  return {
    box: p.box,
    bay: b.idx,
    c,
    d,
    y: p.y,
    cw: b.onZ ? p.w : p.l,
    dl: b.onZ ? p.l : p.w,
    h: p.h,
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

// slide in at its level, or lift over a single-height row: the operator
// stands on the deck with a straight beam, so anything taller than one
// box blocks both sight of the spot and the beam path
function canInsert(aboard: Slot[], t: Slot): boolean {
  if (!aboard.some((r) => laneClash(t, r) && r.d < t.d)) return true
  const overCol = aboard.some(
    (r) => spans(r.c, r.c + r.cw, t.c, t.c + t.cw) && spans(r.d, r.d + r.dl, t.d, t.d + t.dl) && r.y >= t.y + t.h
  )
  if (overCol) return false
  let frontTop = 0
  for (const r of aboard)
    if (spans(r.c, r.c + r.cw, t.c, t.c + t.cw) && r.d < t.d) frontTop = Math.max(frontTop, r.y + r.h)
  return frontTop <= 1
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
  zone: number
): { slot: Slot; key: number[] } | null {
  let best: Slot | null = null
  let bestKey: number[] = [Infinity, Infinity, Infinity, Infinity, Infinity]
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
          // every support cell must be held the box's whole window
          let held = true
          for (let dc = 0; dc < cwf && held; dc++)
            for (let dd = 0; dd < dlf && held; dd++) {
              const under = rivals.find(
                (r) =>
                  r.y + r.h === y &&
                  c + dc >= r.c && c + dc < r.c + r.cw &&
                  d + dd >= r.d && d + dd < r.d + r.dl
              )
              if (!under || !(under.anchor || containsWindow(under, t))) held = false
            }
          if (!held) continue
        }
        let ok = true
        if (!relax.peel)
          for (const r of rivals) {
            if (!laneClash(t, r)) continue
            const pad = r.stop !== t.stop ? gap : 0
            // earlier drop peels first, so it sits nearer the exit
            if (r.drop < t.drop && r.d + r.dl + pad > t.d) { ok = false; break }
            if (r.drop > t.drop && t.d + t.dl + pad > r.d) { ok = false; break }
          }
        if (ok && !relax.build && !canInsert(aboardAtLoad, t)) ok = false
        if (ok && !relax.build && !relax.flank && makesSandwich(rivals, t)) ok = false
        if (!ok) continue
        // in the depth zone, glued to own stop, floor before stacking, shallow, tight
        const glued = rivals.some((r) => r.stop === t.stop && touches(t, r)) ? 0 : 1
        const key = [t.d >= zone ? 0 : 1, glued, t.y, t.d, t.c]
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

function bestFace(bay: BayCtx, rivals: Slot[], probe: Slot, gap: number, relax: Relax): Slot | null {
  const dims = BOX_DIMS[probe.box.size]
  if (!dims) return null
  // the unit's reserved depth zone starts past every co-aboard earlier delivery
  let zone = 0
  for (const s of rivals) if (!s.anchor && s.drop < probe.drop) zone = Math.max(zone, s.d + s.dl)
  const faces: Array<[number, number]> = dims.w === dims.l ? [[dims.w, dims.l]] : [[dims.w, dims.l], [dims.l, dims.w]]
  let best: { slot: Slot; key: number[] } | null = null
  for (const [cwf, dlf] of faces) {
    const s = findSpot(bay, rivals, probe, cwf, dlf, dims.h, gap, relax, zone)
    if (s && (!best || beats(s.key, best.key))) best = s
  }
  return best?.slot ?? null
}

// whole unit into one bay set, no concessions
function seatUnit(cfg: BayCtx[], slots: Slot[], unit: PackBox[], load: number, drop: number, gap: number): Slot[] | null {
  const placed: Slot[] = []
  for (const box of [...unit].sort(unitOrder)) {
    const probe: Slot = { box, bay: -1, c: 0, d: 0, y: 0, cw: 0, dl: 0, h: 0, load, drop, stop: box.stopIdx, anchor: false }
    let got: Slot | null = null
    for (const bay of cfg) {
      const rivals = slots.concat(placed).filter((s) => s.bay === bay.idx && windowsOverlap(s, probe))
      got = bestFace(bay, rivals, probe, gap, {})
      if (got) break
    }
    if (!got) return null
    placed.push(got)
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
  gap: number
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
          const s = bestFace(bay, rivals, probe, rung.gap, rung.relax)
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

// can this drop set physically come out, given the flanking bug
function extractIssues(slots: Slot[], step: number): Strand[] {
  const aboard = slots.filter((s) => s.load <= step && s.drop > step)
  const leaving = slots.filter((s) => s.drop === step)
  const out = new Set<Slot>()
  const present = (): Slot[] => aboard.concat(leaving).filter((s) => !out.has(s))
  const whyStuck = (r: Slot, others: Slot[]): string[] | null => {
    const blockers = new Set<string>()
    if (others.some((q) => laneClash(q, r) && q.d < r.d)) {
      const overCol = others.filter(
        (q) => spans(q.c, q.c + q.cw, r.c, r.c + r.cw) && spans(q.d, q.d + q.dl, r.d, r.d + r.dl) && q.y >= r.y + r.h
      )
      let frontTop = 0
      for (const q of others)
        if (spans(q.c, q.c + q.cw, r.c, r.c + r.cw) && q.d < r.d) frontTop = Math.max(frontTop, q.y + q.h)
      if (overCol.length || frontTop > 1) {
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
            got = bestFace(bay, rivals, probe, rung.gap, rung.relax)
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
  const { loose, pins, gap = 0, frames } = opts
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

  interface PassResult {
    slots: Slot[]
    byBox: Map<string, Slot>
    verdicts: UnitVerdict[]
    concessions: Concession[]
  }
  const runPass = (queue: PackBox[][]): PassResult => {
    const slots: Slot[] = []
    const byBox = new Map<string, Slot>()
    if (pins)
      for (const [id, p] of pins) {
        const bay = bayById.get(p.gridId)
        if (!bay) continue
        const box = boxOf.get(id) ?? p.box
        const s = fromPlacement(bay, { ...p, box }, boxOf.has(id) ? loadOf(id) : 0, boxOf.has(id) ? dropOf(id) : NEVER, !boxOf.has(id))
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
      // whole unit clean in one bay, then a fresh bay, then spilled, then per-box concessions
      const has = (b: BayCtx): boolean => slots.some((s) => s.bay === b.idx && s.stop === stop)
      const homes = open.filter(has).concat(open.filter((b) => !has(b)))
      let placed: Slot[] | null = null
      for (const b of homes) if ((placed = seatUnit([b], slots, unit, load, drop, gap))) break
      if (!placed) {
        const next = bays.find((b) => !open.includes(b))
        if (next && (placed = seatUnit([next], slots, unit, load, drop, gap))) open.push(next)
      }
      if (!placed) placed = seatUnit(open, slots, unit, load, drop, gap)
      if (placed) {
        slots.push(...placed)
        for (const s of placed) byBox.set(s.box.id, s)
        verdicts.push({ stop, load, ok: true, boxes: unit })
      } else {
        const got = seatConceding(bays, open, slots, unit, load, drop, gap)
        slots.push(...got.placed)
        for (const s of got.placed) byBox.set(s.box.id, s)
        concessions.push(...got.conceded)
        if (got.failed.length) verdicts.push({ stop, load, ok: false, boxes: got.failed, reason: 'space' })
        else verdicts.push({ stop, load, ok: true, boxes: unit })
      }
    }
    return { slots, byBox, verdicts, concessions }
  }

  // the most window-constrained cargo shouldn't go last: on any homeless
  // boxes, retry once with their units placed first
  let pass = runPass(ordered)
  if (pass.verdicts.some((v) => !v.ok)) {
    const failedKeys = new Set(pass.verdicts.filter((v) => !v.ok).map((v) => `${v.stop}@${v.load}`))
    const promoted = ordered
      .filter((u) => failedKeys.has(`${u[0].stopIdx}@${loadOf(u[0].id)}`))
      .concat(ordered.filter((u) => !failedKeys.has(`${u[0].stopIdx}@${loadOf(u[0].id)}`)))
    const retry = runPass(promoted)
    const homeless = (p: PassResult): number => p.verdicts.reduce((a, v) => a + (v.ok ? 0 : v.boxes.length), 0)
    if (
      homeless(retry) < homeless(pass) ||
      (homeless(retry) === homeless(pass) && retry.concessions.length < pass.concessions.length)
    )
      pass = retry
  }
  const { slots, byBox, verdicts, concessions } = pass

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
            (q.anchor || containsWindow(q, s))
        )
        if (!under) {
          floatOk = false
          issues.push(`box ${s.box.id} floats at y=${s.y}`)
        }
      }
  }

  return { snaps, verdicts, concessions, proofs: { floatOk, buildOk, extractOk, issues } }
}
