// capacitated pickup-and-delivery planner. when the whole haul can be ordered
// to stay under the hold, it returns the exact optimal single pass; when it
// can't, it splits into multiple trips so the load never tops the limit. with
// bays supplied it also checks each load physically packs, deferring the rest.

import { packCargo, type PackBox } from './packer'
import type { CargoGrid } from './cargoGrids'

export interface RouteJob {
  pickup: number
  dest: number
  scu: number
  /** box sizes making up this cargo, for the physical pack check */
  boxes?: number[]
}

export interface RouteInput {
  /** unique location count, node ids 0..n-1 */
  n: number
  jobs: RouteJob[]
  /** nxn travel cost, finite large value for unknown legs */
  dist: number[][]
  /** <= 0 disables capacity constraint */
  capacity: number
  /** pin start node, else solver picks cheapest */
  start?: number
  /** auto-load bays; when set, loads are checked to physically fit */
  bays?: CargoGrid[]
  /** user-chosen visit order (node ids); when set the solver follows it as-is */
  fixedOrder?: number[]
}

/** one physical stop; a location can appear more than once across trips */
export interface PlannedStop {
  node: number
  /** original job indices loaded here */
  pickJobs: number[]
  /** original job indices dropped here */
  dropJobs: number[]
  /** scu aboard leaving this stop */
  loadAfter: number
  /** 0-based trip number, bumps each time the hold empties for a fresh run */
  trip: number
  /** cargo here that wouldn't fit this pass, left for a return trip */
  deferJobs?: number[]
}

export interface RouteResult {
  /** distinct nodes in first-visit order */
  order: number[]
  stops: PlannedStop[]
  totalDistance: number
  peakLoad: number
  feasible: boolean
  method: 'exact' | 'heuristic' | 'multitrip' | 'manual'
  /** job indices too big for the hold to carry in one piece */
  unfittable: number[]
  /** set when something couldn't be planned cleanly */
  reason?: string
}

// bitmasks are 32-bit; beyond this the exact search can't run
const EXACT_NODE_MAX = 30
// cap exact-search transitions so a pathological instance can't jank the UI.
// tight cargo capacity keeps real runs far under this; only loose-capacity
// instances with many stops approach it, and those fall to the polished
// local search instead.
const EXACT_WORK_BUDGET = 2_500_000

/** drop same-location jobs */
function realJobs(jobs: RouteJob[]): RouteJob[] {
  return jobs.filter((j) => j.pickup !== j.dest && j.scu > 0)
}

/** scu picked up but not yet delivered in mask */
function loadForMask(mask: number, jobs: RouteJob[]): number {
  let load = 0
  for (const j of jobs) {
    const got = (mask >> j.pickup) & 1
    const gone = (mask >> j.dest) & 1
    if (got && !gone) load += j.scu
  }
  return load
}

/** can't visit a dest until its pickup is aboard */
function canVisit(mask: number, v: number, jobs: RouteJob[]): boolean {
  if ((mask >> v) & 1) return false
  for (const j of jobs) {
    if (j.dest === v && !((mask >> j.pickup) & 1)) return false
  }
  return true
}

const popcount = (m: number): number => {
  let c = 0
  while (m) {
    m &= m - 1
    c++
  }
  return c
}

// exact min-distance route, kept feasible on capacity + pickup-before-delivery.
// held-karp over only the states tight cargo capacity actually allows, so the
// reachable set stays small for real runs. returns 'too-big' if the search
// would exceed the work budget, null if no capacity-feasible order exists.
function solveExact(input: RouteInput): number[] | null | 'too-big' {
  const { n, dist, capacity } = input
  if (n > EXACT_NODE_MAX) return 'too-big'
  const jobs = realJobs(input.jobs)
  const full = (1 << n) - 1
  const cap = capacity > 0 ? capacity : Infinity

  const dp = new Map<number, { cost: Float64Array; par: Int32Array }>()
  const ensure = (mask: number): { cost: Float64Array; par: Int32Array } => {
    let e = dp.get(mask)
    if (!e) {
      e = { cost: new Float64Array(n).fill(Infinity), par: new Int32Array(n).fill(-1) }
      dp.set(mask, e)
    }
    return e
  }
  const byLevel: number[][] = Array.from({ length: n + 1 }, () => [])
  const seen = new Set<number>()
  const push = (mask: number): void => {
    if (seen.has(mask)) return
    seen.add(mask)
    byLevel[popcount(mask)].push(mask)
  }

  for (let v = 0; v < n; v++) {
    if (input.start !== undefined && v !== input.start) continue
    const m = 1 << v
    if (canVisit(0, v, jobs) && loadForMask(m, jobs) <= cap) {
      ensure(m).cost[v] = 0
      push(m)
    }
  }

  let work = 0
  for (let k = 1; k < n; k++) {
    for (const mask of byLevel[k]) {
      const e = dp.get(mask) as { cost: Float64Array; par: Int32Array }
      for (let last = 0; last < n; last++) {
        const base = e.cost[last]
        if (base === Infinity) continue
        for (let v = 0; v < n; v++) {
          if (mask & (1 << v)) continue
          if (!canVisit(mask, v, jobs)) continue
          const nmask = mask | (1 << v)
          if (loadForMask(nmask, jobs) > cap) continue
          if (++work > EXACT_WORK_BUDGET) return 'too-big'
          const ne = ensure(nmask)
          const cost = base + dist[last][v]
          if (cost < ne.cost[v]) {
            ne.cost[v] = cost
            ne.par[v] = last
          }
          push(nmask)
        }
      }
    }
  }

  const fe = dp.get(full)
  if (!fe) return null
  let best = Infinity
  let bestLast = -1
  for (let v = 0; v < n; v++) {
    if (fe.cost[v] < best) {
      best = fe.cost[v]
      bestLast = v
    }
  }
  if (bestLast < 0) return null
  const order: number[] = []
  let mask = full
  let last = bestLast
  while (last !== -1) {
    order.push(last)
    const prev = (dp.get(mask) as { par: Int32Array }).par[last]
    mask &= ~(1 << last)
    last = prev
  }
  order.reverse()
  return order
}

function orderDistance(order: number[], dist: number[][]): number {
  let total = 0
  for (let i = 1; i < order.length; i++) total += dist[order[i - 1]][order[i]]
  return total
}

function orderFeasible(order: number[], jobs: RouteJob[], cap: number): boolean {
  let mask = 0
  for (const v of order) {
    if (!canVisit(mask, v, jobs)) return false
    mask |= 1 << v
    if (loadForMask(mask, jobs) > cap) return false
  }
  return true
}

/** greedy nearest-feasible order from one start, or null if it dead-ends */
function greedyFrom(input: RouteInput, cap: number, start: number): number[] | null {
  const { n, dist } = input
  const jobs = realJobs(input.jobs)
  const order = [start]
  let mask = 1 << start
  while (order.length < n) {
    let next = -1
    let nextCost = Infinity
    for (let v = 0; v < n; v++) {
      if (mask & (1 << v)) continue
      if (!canVisit(mask, v, jobs)) continue
      if (loadForMask(mask | (1 << v), jobs) > cap) continue
      const d = dist[order[order.length - 1]][v]
      if (d < nextCost) {
        nextCost = d
        next = v
      }
    }
    if (next < 0) return null
    order.push(next)
    mask |= 1 << next
  }
  return order
}

/** greedy nearest-feasible seed, best over all allowed starts */
function greedySeed(input: RouteInput, cap: number): number[] | null {
  const { n } = input
  const jobs = realJobs(input.jobs)
  let bestOrder: number[] | null = null
  let bestCost = Infinity
  for (let start = 0; start < n; start++) {
    if (input.start !== undefined && start !== input.start) continue
    if (!canVisit(0, start, jobs) || loadForMask(1 << start, jobs) > cap) continue
    const order = greedyFrom(input, cap, start)
    if (!order) continue
    const cost = orderDistance(order, input.dist)
    if (cost < bestCost) {
      bestCost = cost
      bestOrder = order
    }
  }
  return bestOrder
}

// or-opt (relocate a run of 1-3 stops) + 2-opt (reverse a segment), every
// candidate kept feasible. used only when the exact search is out of budget,
// so the fallback stays near optimal rather than raw nearest-neighbour.
function localSearch(seed: number[], input: RouteInput, cap: number): number[] {
  const jobs = realJobs(input.jobs)
  const dist = input.dist
  const pinnedStart = input.start !== undefined
  const firstMovable = pinnedStart ? 1 : 0
  let best = seed.slice()
  let bestD = orderDistance(best, dist)
  const take = (cand: number[]): boolean => {
    if (pinnedStart && cand[0] !== input.start) return false
    if (!orderFeasible(cand, jobs, cap)) return false
    const d = orderDistance(cand, dist)
    if (d < bestD - 1e-9) {
      best = cand
      bestD = d
      return true
    }
    return false
  }
  let improved = true
  while (improved) {
    improved = false
    for (let len = 1; len <= 3; len++) {
      for (let i = firstMovable; i + len <= best.length; i++) {
        const seg = best.slice(i, i + len)
        const rest = best.slice(0, i).concat(best.slice(i + len))
        for (let j = firstMovable; j <= rest.length; j++) {
          if (j === i) continue
          const cand = rest.slice(0, j).concat(seg, rest.slice(j))
          if (take(cand)) improved = true
        }
      }
    }
    for (let i = firstMovable; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1))
        if (take(cand)) improved = true
      }
    }
  }
  return best
}

// best of every allowed start, each polished, so one unlucky seed can't
// trap the fallback in a bad local minimum
function solveHeuristic(input: RouteInput, cap: number): number[] | null {
  const { n } = input
  const jobs = realJobs(input.jobs)
  let best: number[] | null = null
  let bestD = Infinity
  for (let s = 0; s < n; s++) {
    if (input.start !== undefined && s !== input.start) continue
    if (!canVisit(0, s, jobs) || loadForMask(1 << s, jobs) > cap) continue
    const seed = greedyFrom(input, cap, s)
    if (!seed) continue
    const polished = localSearch(seed, input, cap)
    const d = orderDistance(polished, input.dist)
    if (d < bestD) {
      bestD = d
      best = polished
    }
  }
  if (best) return best
  // no per-start seed completed; fall back to the global greedy
  const seed = greedySeed(input, cap)
  return seed ? localSearch(seed, input, cap) : null
}

/** best single-pass order keeping load under cap, or null if none exists */
function bestOrder(input: RouteInput): { order: number[]; method: 'exact' | 'heuristic' } | null {
  const exact = solveExact(input)
  if (exact === 'too-big') {
    const cap = input.capacity > 0 ? input.capacity : Infinity
    const h = solveHeuristic(input, cap)
    return h ? { order: h, method: 'heuristic' } : null
  }
  return exact ? { order: exact, method: 'exact' } : null
}

interface IJob {
  pickup: number
  dest: number
  scu: number
  idx: number
  boxes: number[]
}

function indexedJobs(jobs: RouteJob[]): IJob[] {
  const out: IJob[] = []
  jobs.forEach((j, idx) => {
    if (j.pickup !== j.dest && j.scu > 0)
      out.push({ pickup: j.pickup, dest: j.dest, scu: j.scu, idx, boxes: j.boxes ?? [] })
  })
  return out
}

// does this cargo physically pack into the bays? the grid stacks in delivery
// order (later drops on the bottom, earlier ones reachable on top), and that
// accessibility rule costs space, so the check has to use the same ranking or
// it'll green-light loads the grid can't actually place. rankOf gives each
// job's dest its delivery position; without it we fall back to a flat pack.
function loadFits(jobs: IJob[], bays: CargoGrid[], rankOf?: (dest: number) => number): boolean {
  const boxes: PackBox[] = []
  let n = 0
  for (const j of jobs) {
    const stopIdx = rankOf ? rankOf(j.dest) : 0
    for (const size of j.boxes)
      boxes.push({ id: String(n++), size, color: '', dest: '', stopIdx, objectiveId: '' })
  }
  if (!boxes.length) return true
  return packCargo(bays, boxes).unplaced.length === 0
}

const distinctNodes = (stops: PlannedStop[]): number[] => {
  const seen = new Set<number>()
  const out: number[] = []
  for (const s of stops) if (!seen.has(s.node)) { seen.add(s.node); out.push(s.node) }
  return out
}

// walk a single-pass node order, dropping then loading at each node
function materialize(
  order: number[],
  jobs: IJob[],
  dist: number[][]
): { stops: PlannedStop[]; totalDistance: number; peakLoad: number } {
  const stops: PlannedStop[] = []
  const aboard = new Set<number>()
  let load = 0
  let peak = 0
  let total = 0
  for (let k = 0; k < order.length; k++) {
    const node = order[k]
    if (k > 0) total += dist[order[k - 1]][node]
    const dropJobs: number[] = []
    const pickJobs: number[] = []
    for (const j of jobs) {
      if (j.dest === node && aboard.has(j.idx)) {
        aboard.delete(j.idx)
        load -= j.scu
        dropJobs.push(j.idx)
      }
    }
    for (const j of jobs) {
      if (j.pickup === node && !aboard.has(j.idx)) {
        aboard.add(j.idx)
        load += j.scu
        pickJobs.push(j.idx)
      }
    }
    if (load > peak) peak = load
    stops.push({ node, pickJobs, dropJobs, loadAfter: load, trip: 0 })
  }
  return { stops, totalDistance: total, peakLoad: peak }
}

// over-capacity hauls: drive stop to stop, dropping everything destined where
// we are and loading what fits, revisiting as needed. load can't top the hold
// (loads are bounded by free space) and nothing strands (every aboard item's
// dest stays on the worklist until visited). nodes may repeat; a fresh trip
// begins whenever the hold empties and we load again.
function planMultiTrip(input: RouteInput): RouteResult {
  const { dist } = input
  const cap = input.capacity
  const all = indexedJobs(input.jobs)
  const unfittable = all.filter((j) => j.scu > cap).map((j) => j.idx)
  const byIdx = new Map(all.filter((j) => j.scu <= cap).map((j) => [j.idx, j]))
  const pending = new Set(byIdx.keys())
  const aboard: IJob[] = []
  let load = 0
  let cur = input.start ?? (pending.size ? (byIdx.get([...pending][0]) as IJob).pickup : 0)

  const stops: PlannedStop[] = []
  let total = 0
  let peak = 0
  let trip = 0
  let started = false

  const bays = input.bays
  let guard = all.length * 20 + 200 // termination backstop
  while ((pending.size || aboard.length) && guard-- > 0) {
    const locs = new Set<number>()
    for (const j of aboard) locs.add(j.dest)
    for (const idx of pending) locs.add((byIdx.get(idx) as IJob).pickup)

    // pick the nearest location where we can drop or load something
    let best: { L: number; drops: IJob[]; loads: IJob[] } | null = null
    let bestD = Infinity
    for (const L of locs) {
      const drops = aboard.filter((j) => j.dest === L)
      let free = cap - load + drops.reduce((a, j) => a + j.scu, 0)
      const here = [...pending]
        .map((i) => byIdx.get(i) as IJob)
        .filter((j) => j.pickup === L)
        .sort((a, b) => b.scu - a.scu)
      const loads: IJob[] = []
      for (const j of here) {
        if (j.scu <= free) {
          loads.push(j)
          free -= j.scu
        }
      }
      if (!drops.length && !loads.length) continue
      const d = dist[cur][L]
      if (d < bestD) {
        bestD = d
        best = { L, drops, loads }
      }
    }
    if (!best) break

    // keep only what physically packs alongside what stays aboard; the biggest
    // boxes (sorted first) get bumped to a return trip when they won't fit
    if (bays && best.loads.length) {
      const remain = aboard.filter((j) => !best!.drops.some((d) => d.idx === j.idx))
      // nearest dest is delivered first, so rank by distance to match the grid
      const ranked = [...new Set([...remain, ...best.loads].map((j) => j.dest))].sort(
        (a, b) => dist[best!.L][a] - dist[best!.L][b]
      )
      const rankMap = new Map(ranked.map((d, i) => [d, i]))
      const rankOf = (dest: number): number => rankMap.get(dest) ?? ranked.length
      const keep = best.loads.slice()
      while (keep.length && !loadFits([...remain, ...keep], bays, rankOf)) keep.shift()
      // nothing new fits here: if a single box won't fit an empty hold it can
      // never be carried; otherwise deliver first to free room
      if (!keep.length && !best.drops.length) {
        if (!aboard.length) {
          const small = best.loads[best.loads.length - 1]
          unfittable.push(small.idx)
          pending.delete(small.idx)
          continue
        }
        let L2 = aboard[0].dest
        let d2 = dist[cur][L2]
        for (const j of aboard) {
          const d = dist[cur][j.dest]
          if (d < d2) {
            d2 = d
            L2 = j.dest
          }
        }
        best = { L: L2, drops: aboard.filter((j) => j.dest === L2), loads: [] }
      } else {
        best = { L: best.L, drops: best.drops, loads: keep }
      }
    }

    total += dist[cur][best.L]
    const dropJobs: number[] = []
    for (const j of best.drops) {
      load -= j.scu
      dropJobs.push(j.idx)
    }
    if (best.drops.length) {
      const dropped = new Set(best.drops.map((j) => j.idx))
      for (let i = aboard.length - 1; i >= 0; i--) if (dropped.has(aboard[i].idx)) aboard.splice(i, 1)
    }

    const pickJobs: number[] = []
    if (best.loads.length) {
      if (started && load === 0) trip++
      started = true
      for (const j of best.loads) {
        load += j.scu
        aboard.push(j)
        pending.delete(j.idx)
        pickJobs.push(j.idx)
      }
    }
    if (load > peak) peak = load
    stops.push({ node: best.L, pickJobs, dropJobs, loadAfter: load, trip })
    cur = best.L
  }

  return {
    order: distinctNodes(stops),
    stops,
    totalDistance: total,
    peakLoad: peak,
    feasible: unfittable.length === 0,
    method: 'multitrip',
    unfittable,
    reason: unfittable.length
      ? 'Some objectives are larger than your hold and cannot be carried in one piece.'
      : undefined
  }
}

// follow the user's stop order exactly, but never overload: at each stop drop
// what's destined there, then load only what fits and physically packs. cargo
// that won't fit is left behind and picked up on a later pass once deliveries
// free room. nodes can repeat across passes, just like a real return trip.
function planManual(input: RouteInput): RouteResult {
  const order = (input.fixedOrder ?? []).filter((v, i, a) => a.indexOf(v) === i)
  const dist = input.dist
  const cap = input.capacity > 0 ? input.capacity : Infinity
  // deliveries happen in the visit order, so that's the grid's stacking order
  const rankOf = (dest: number): number => {
    const i = order.indexOf(dest)
    return i < 0 ? order.length : i
  }
  const all = indexedJobs(input.jobs)
  const unfittable = all.filter((j) => j.scu > cap).map((j) => j.idx)
  const byIdx = new Map(all.filter((j) => j.scu <= cap).map((j) => [j.idx, j]))
  const pending = new Set(byIdx.keys())
  const aboard: IJob[] = []
  const bays = input.bays
  let load = 0
  let cur = input.start ?? order[0] ?? 0
  let total = 0
  let peak = 0
  let trip = 0
  let started = false
  const stops: PlannedStop[] = []

  let guard = all.length * (order.length + 2) + 200
  while ((pending.size || aboard.length) && guard-- > 0) {
    let progressed = false
    for (const L of order) {
      const drops = aboard.filter((j) => j.dest === L)
      let free = cap - load + drops.reduce((a, j) => a + j.scu, 0)
      const here = [...pending]
        .map((i) => byIdx.get(i) as IJob)
        .filter((j) => j.pickup === L)
        .sort((a, b) => b.scu - a.scu)
      const loads: IJob[] = []
      for (const j of here) {
        if (j.scu <= free) {
          loads.push(j)
          free -= j.scu
        }
      }
      // biggest-first sort means shift() bumps the largest until the rest pack
      if (bays && loads.length) {
        const remain = aboard.filter((j) => !drops.some((d) => d.idx === j.idx))
        while (loads.length && !loadFits([...remain, ...loads], bays, rankOf)) loads.shift()
      }
      if (!drops.length && !loads.length) continue

      const took = new Set(loads.map((j) => j.idx))
      const deferJobs = here.filter((j) => !took.has(j.idx)).map((j) => j.idx)

      total += dist[cur][L]
      const dropJobs: number[] = []
      for (const j of drops) {
        load -= j.scu
        dropJobs.push(j.idx)
      }
      if (drops.length) {
        const dropped = new Set(dropJobs)
        for (let i = aboard.length - 1; i >= 0; i--) if (dropped.has(aboard[i].idx)) aboard.splice(i, 1)
      }
      const pickJobs: number[] = []
      if (loads.length) {
        if (started && load === 0) trip++
        started = true
        for (const j of loads) {
          load += j.scu
          aboard.push(j)
          pending.delete(j.idx)
          pickJobs.push(j.idx)
        }
      }
      if (load > peak) peak = load
      stops.push({ node: L, pickJobs, dropJobs, loadAfter: load, trip, deferJobs })
      cur = L
      progressed = true
    }
    if (!progressed) break
  }

  return {
    order: distinctNodes(stops),
    stops,
    totalDistance: total,
    peakLoad: peak,
    feasible: unfittable.length === 0 && pending.size === 0,
    method: 'manual',
    unfittable,
    reason: unfittable.length
      ? 'Some objectives are larger than your hold and cannot be carried in one piece.'
      : pending.size
        ? 'Some cargo could not be slotted into the order you set.'
        : undefined
  }
}

const empty = (): RouteResult => ({
  order: [],
  stops: [],
  totalDistance: 0,
  peakLoad: 0,
  feasible: true,
  method: 'exact',
  unfittable: []
})

// the fullest moment of a single pass; true if that load physically packs in
// delivery order, the same way the grid lays it out
function singlePassPacks(stops: PlannedStop[], jobs: IJob[], bays: CargoGrid[]): boolean {
  const byIdx = new Map(jobs.map((j) => [j.idx, j]))
  const rank = new Map<number, number>()
  for (const s of stops) if (s.dropJobs.length && !rank.has(s.node)) rank.set(s.node, rank.size)
  const rankOf = (dest: number): number => rank.get(dest) ?? rank.size
  const aboard = new Set<number>()
  let peak: IJob[] = []
  let bestLoad = -1
  for (const s of stops) {
    for (const ji of s.dropJobs) aboard.delete(ji)
    for (const ji of s.pickJobs) aboard.add(ji)
    if (s.loadAfter > bestLoad) {
      bestLoad = s.loadAfter
      peak = [...aboard].map((i) => byIdx.get(i) as IJob)
    }
  }
  return loadFits(peak, bays, rankOf)
}

export function planRoute(input: RouteInput): RouteResult {
  const { n, capacity } = input
  if (n === 0) return empty()
  const jobs = indexedJobs(input.jobs)
  if (jobs.length === 0) return { ...empty(), order: input.fixedOrder ?? Array.from({ length: n }, (_, i) => i) }

  // user set the order: follow it, capping loads to the hold and deferring the
  // overflow to a return pass
  if (input.fixedOrder && input.fixedOrder.length) return planManual(input)

  // single pass first: if some order keeps us under the hold AND that load
  // physically packs, that's optimal
  const single = bestOrder(input)
  if (single) {
    const mat = materialize(single.order, jobs, input.dist)
    if (!input.bays || singlePassPacks(mat.stops, jobs, input.bays)) {
      return {
        order: single.order,
        stops: mat.stops,
        totalDistance: mat.totalDistance,
        peakLoad: mat.peakLoad,
        feasible: true,
        method: single.method,
        unfittable: []
      }
    }
  }

  // can't stay under the hold in one pass (or it won't pack): split into trips
  if (capacity > 0) return planMultiTrip(input)

  // no capacity limit yet no feasible order: precedence is unsatisfiable
  const order = Array.from({ length: n }, (_, i) => i)
  const mat = materialize(order, jobs, input.dist)
  return {
    order,
    stops: mat.stops,
    totalDistance: mat.totalDistance,
    peakLoad: mat.peakLoad,
    feasible: false,
    method: 'exact',
    unfittable: [],
    reason: 'Could not satisfy pickup-before-delivery ordering.'
  }
}
