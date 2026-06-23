// Capacitated pickup-and-delivery route planner for a single ship.
//
// The hauling problem: each contract has ONE pickup location and N delivery
// objectives (each its own destination + SCU). You must pick a contract's cargo
// up before you can drop any of it off, and the cargo you're carrying can never
// exceed the ship's SCU at any point in the run. Goal: order the location visits
// to minimise total travel (UEX terminal-to-terminal distance), e.g. batch two
// Crusader-area pickups before the single hop to ArcCorp because both deliver to
// Baijini Point.
//
// This is a capacitated PDP (NP-hard) but real manifests are tiny (a handful of
// unique locations), so we solve it exactly with a Held-Karp DP over visited
// subsets for n <= HK_MAX, and fall back to a greedy nearest-feasible heuristic
// beyond that. Pure and deterministic, so it's easy to test.

export interface RouteJob {
  /** index into the locations array - where this cargo is loaded. */
  pickup: number
  /** index into the locations array - where it's delivered. */
  dest: number
  /** SCU carried between pickup and dest. */
  scu: number
}

export interface RouteInput {
  /** number of unique locations (node ids 0..n-1). */
  n: number
  jobs: RouteJob[]
  /** nxn travel cost; dist[i][j] >= 0. Use a finite large value for unknown legs. */
  dist: number[][]
  /** ship capacity in SCU. <= 0 disables the capacity constraint. */
  capacity: number
  /** force the route to begin at this node (a depot / where the run starts). When
   *  unset, the solver is free to choose the cheapest starting node. */
  start?: number
}

export interface RouteResult {
  /** visit order - a permutation of the location indices. */
  order: number[]
  /** total travel cost along `order`. */
  totalDistance: number
  /** cargo aboard right AFTER visiting order[k] (deliver-then-load at each stop). */
  loadAfter: number[]
  /** peak cargo aboard across the whole run. */
  peakLoad: number
  /** true when precedence + capacity are both satisfied by `order`. */
  feasible: boolean
  method: 'exact' | 'heuristic'
  /** set when not feasible (capacity bottleneck); order is still a best effort. */
  reason?: string
}

const HK_MAX = 15 // 2^15 * 15 states - still instant; above this we go heuristic

/** Drop trivial same-location jobs (load + unload at one stop never ride along). */
function realJobs(jobs: RouteJob[]): RouteJob[] {
  return jobs.filter((j) => j.pickup !== j.dest && j.scu > 0)
}

/** Cargo aboard once the visited set is `mask`: picked up (pickup in mask) but not
 *  yet delivered (dest not in mask). Precedence guarantees dest in mask => pickup in mask. */
function loadForMask(mask: number, jobs: RouteJob[]): number {
  let load = 0
  for (const j of jobs) {
    const got = (mask >> j.pickup) & 1
    const gone = (mask >> j.dest) & 1
    if (got && !gone) load += j.scu
  }
  return load
}

/** A location can be visited only once every contract delivered THERE is aboard. */
function canVisit(mask: number, v: number, jobs: RouteJob[]): boolean {
  if ((mask >> v) & 1) return false
  for (const j of jobs) {
    if (j.dest === v && !((mask >> j.pickup) & 1)) return false
  }
  return true
}

function pathStats(
  order: number[],
  jobs: RouteJob[],
  dist: number[][],
  capacity: number
): { totalDistance: number; loadAfter: number[]; peakLoad: number; feasible: boolean } {
  let mask = 0
  let total = 0
  let peak = 0
  let feasible = true
  const loadAfter: number[] = []
  for (let k = 0; k < order.length; k++) {
    const v = order[k]
    if (!canVisit(mask, v, jobs)) feasible = false
    if (k > 0) total += dist[order[k - 1]][v]
    mask |= 1 << v
    const load = loadForMask(mask, jobs)
    loadAfter.push(load)
    if (load > peak) peak = load
  }
  if (capacity > 0 && peak > capacity) feasible = false
  return { totalDistance: total, loadAfter, peakLoad: peak, feasible }
}

/** Exact open-path Held-Karp with precedence + capacity feasibility masks. */
function solveExact(input: RouteInput): number[] | null {
  const { n, dist, capacity } = input
  const jobs = realJobs(input.jobs)
  const full = (1 << n) - 1
  const cap = capacity > 0 ? capacity : Infinity
  const NEG = Infinity
  // dp[mask][last] = min cost of a feasible path visiting exactly mask, ending at last
  const dp: Float64Array[] = Array.from({ length: 1 << n }, () => new Float64Array(n).fill(NEG))
  const par = Array.from({ length: 1 << n }, () => new Int8Array(n).fill(-1))

  for (let v = 0; v < n; v++) {
    if (input.start !== undefined && v !== input.start) continue
    if (canVisit(0, v, jobs) && loadForMask(1 << v, jobs) <= cap) dp[1 << v][v] = 0
  }
  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < n; last++) {
      const base = dp[mask][last]
      if (base === NEG) continue
      for (let v = 0; v < n; v++) {
        if (!canVisit(mask, v, jobs)) continue
        const nmask = mask | (1 << v)
        if (loadForMask(nmask, jobs) > cap) continue
        const cost = base + dist[last][v]
        if (cost < dp[nmask][v]) {
          dp[nmask][v] = cost
          par[nmask][v] = last
        }
      }
    }
  }
  let best = NEG
  let bestLast = -1
  for (let v = 0; v < n; v++) {
    if (dp[full][v] < best) {
      best = dp[full][v]
      bestLast = v
    }
  }
  if (bestLast < 0) return null // no capacity/precedence-feasible full tour
  const order: number[] = []
  let mask = full
  let last = bestLast
  while (last !== -1) {
    order.push(last)
    const prev = par[mask][last]
    mask &= ~(1 << last)
    last = prev
  }
  order.reverse()
  return order
}

/** Greedy nearest-feasible fallback (large n). Tries each start, keeps the best;
 *  if capacity blocks everything, retries ignoring capacity so we still emit an
 *  order (flagged infeasible by pathStats). */
function solveGreedy(input: RouteInput, enforceCap: boolean): number[] | null {
  const { n, dist, capacity } = input
  const jobs = realJobs(input.jobs)
  const cap = enforceCap && capacity > 0 ? capacity : Infinity
  let bestOrder: number[] | null = null
  let bestCost = Infinity
  for (let start = 0; start < n; start++) {
    if (input.start !== undefined && start !== input.start) continue
    if (!canVisit(0, start, jobs) || loadForMask(1 << start, jobs) > cap) continue
    const order = [start]
    let mask = 1 << start
    let cost = 0
    let ok = true
    while (order.length < n) {
      let next = -1
      let nextCost = Infinity
      for (let v = 0; v < n; v++) {
        if (!canVisit(mask, v, jobs)) continue
        if (loadForMask(mask | (1 << v), jobs) > cap) continue
        const d = dist[order[order.length - 1]][v]
        if (d < nextCost) {
          nextCost = d
          next = v
        }
      }
      if (next < 0) {
        ok = false
        break
      }
      order.push(next)
      mask |= 1 << next
      cost += nextCost
    }
    if (ok && cost < bestCost) {
      bestCost = cost
      bestOrder = order
    }
  }
  return bestOrder
}

export function planRoute(input: RouteInput): RouteResult {
  const { n } = input
  if (n === 0) return { order: [], totalDistance: 0, loadAfter: [], peakLoad: 0, feasible: true, method: 'exact' }
  if (n === 1) return { order: [0], totalDistance: 0, loadAfter: [loadForMask(1, realJobs(input.jobs))], peakLoad: 0, feasible: true, method: 'exact' }

  const exact = n <= HK_MAX
  let order = exact ? solveExact(input) : solveGreedy(input, true)
  let reason: string | undefined
  if (!order) {
    // No capacity-feasible single-trip ordering, so fall back to a precedence-only
    // route (capacity ignored) so the user still sees a plan plus the overflow.
    order = exact
      ? solveExact({ ...input, capacity: 0 })
      : solveGreedy(input, false)
    reason = 'Cargo exceeds ship capacity. No single-trip order fits; showing best pickup-before-delivery order.'
  }
  if (!order) {
    // precedence itself is impossible (shouldn't happen with well-formed jobs)
    order = Array.from({ length: n }, (_, i) => i)
    reason = 'Could not satisfy pickup-before-delivery ordering.'
  }
  const stats = pathStats(order, realJobs(input.jobs), input.dist, input.capacity)
  return { order, ...stats, method: exact ? 'exact' : 'heuristic', reason: stats.feasible ? undefined : reason }
}
