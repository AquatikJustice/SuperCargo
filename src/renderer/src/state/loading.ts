import type { HaulingContract } from '@shared/types'
import { boxBreakdown, calculateBoxes, boxList, listBreakdown } from '@shared/box'
import type { PackBox, LoadEvent } from '@shared/packer'
import { activeContracts, destinationsInOrder } from './manifest'
import type { RoutePlan, StepRef } from './route'

const undelivered = (c: HaulingContract): HaulingContract['objectives'] =>
  c.objectives.filter((o) => !o.delivered)

const tellLabel = (commodity: string, size: number, count: number): string =>
  `${count}× ${size} SCU ${commodity}`

// distinctive tell per contract
function distinctiveTells(contracts: HaulingContract[]): Map<string, string | null> {
  const live = activeContracts(contracts)
  const tupleOwners = new Map<string, Set<string>>()
  const commodityOwners = new Map<string, Set<string>>()
  const add = (owners: Map<string, Set<string>>, key: string, id: string): void => {
    const set = owners.get(key) ?? new Set<string>()
    set.add(id)
    owners.set(key, set)
  }
  for (const c of live) {
    for (const o of undelivered(c)) {
      add(commodityOwners, o.commodity, c.id)
      for (const b of o.boxes) add(tupleOwners, `${o.commodity}|${b.scuSize}|${b.count}`, c.id)
    }
  }

  const tells = new Map<string, string | null>()
  for (const c of live) {
    let best: { size: number; count: number; commodity: string } | null = null
    for (const o of undelivered(c)) {
      for (const b of o.boxes) {
        const owners = tupleOwners.get(`${o.commodity}|${b.scuSize}|${b.count}`)
        if (owners && owners.size === 1) {
          if (!best || b.scuSize > best.size || (b.scuSize === best.size && b.count > best.count))
            best = { size: b.scuSize, count: b.count, commodity: o.commodity }
        }
      }
    }
    if (best) {
      tells.set(c.id, tellLabel(best.commodity, best.size, best.count))
      continue
    }
    const uniqueCommodity = undelivered(c)
      .map((o) => o.commodity)
      .find((cm) => commodityOwners.get(cm)?.size === 1)
    tells.set(c.id, uniqueCommodity ? `the only ${uniqueCommodity}` : null)
  }
  return tells
}

export interface RouteLoadLine {
  ref: string
  tell: string | null
  commodity: string
  /** scu moved this step */
  scu: number
  /** full objective scu */
  totalScu: number
  breakdown: string
  /** box sizes loaded this step */
  loadBoxes: number[]
  /** breakdown of the whole objective */
  totalBreakdown: string
  destination: string
  multiPickup: boolean
  objectiveId: string
  contractId: string
  /** 1-based trip for this objective */
  tripPos: number
  tripTotal: number
}

export interface RouteLoadStop {
  nodeKey: string
  label: string
  code: string
  region: string
  loads: RouteLoadLine[]
  drops: RouteLoadLine[]
  loadAfter: number
  objectiveIds: string[]
  trip: number
}

export function buildRouteLoadingPlan(
  contracts: HaulingContract[],
  plan: RoutePlan
): RouteLoadStop[] {
  const tells = distinctiveTells(contracts)
  const byObjective = new Map(
    activeContracts(contracts).flatMap((c) => c.objectives.map((o) => [o.id, { c, o }] as const))
  )
  // trips each objective rides on
  const tripSpan = new Map<string, number[]>()
  for (const s of plan.steps) {
    for (const r of s.loadRefs) {
      const arr = tripSpan.get(r.objectiveId) ?? []
      if (!arr.includes(s.trip)) {
        arr.push(s.trip)
        arr.sort((a, b) => a - b)
        tripSpan.set(r.objectiveId, arr)
      }
    }
  }
  const lineFor = (ref: StepRef, trip: number): RouteLoadLine | null => {
    const found = byObjective.get(ref.objectiveId)
    if (!found) return null
    const { c, o } = found
    const span = tripSpan.get(o.id) ?? [trip]
    // reconstruct boxes for older models
    const loadBoxes = ref.boxes ?? boxList(calculateBoxes(ref.scu, c.maxBoxSize))
    return {
      ref: c.ref,
      tell: tells.get(c.id) ?? null,
      commodity: o.commodity,
      scu: ref.scu,
      totalScu: o.scuAmount,
      breakdown: listBreakdown(loadBoxes),
      loadBoxes,
      totalBreakdown: boxBreakdown(o.boxes),
      destination: o.destination,
      multiPickup: (o.pickups?.length ?? 0) > 1,
      objectiveId: o.id,
      contractId: c.id,
      tripPos: Math.max(1, span.indexOf(trip) + 1),
      tripTotal: span.length
    }
  }

  const stops: RouteLoadStop[] = []
  for (const s of plan.steps) {
    const loads = s.loadRefs.map((r) => lineFor(r, s.trip)).filter((l): l is RouteLoadLine => !!l)
    const drops = s.dropRefs.map((r) => lineFor(r, s.trip)).filter((l): l is RouteLoadLine => !!l)
    if (!loads.length && !drops.length) continue
    stops.push({
      nodeKey: s.nodeKey,
      label: s.label,
      code: s.code,
      region: s.region,
      loads,
      drops,
      loadAfter: s.loadAfter,
      objectiveIds: [...new Set([...loads, ...drops].map((l) => l.objectiveId))],
      trip: s.trip
    })
  }
  return stops
}

// one drop or destination load
export interface LoadingStep {
  nodeKey: string
  label: string
  code: string
  region: string
  trip: number
  /** the synthetic step 0: empty ship at the depot, set up before heading out */
  start?: boolean
  kind: 'load' | 'drop'
  /** load destination, else the stop */
  boundFor: string
  /** 1-based load group, 0 on drop */
  groupPos: number
  groupTotal: number
  lines: RouteLoadLine[]
  loadIds: string[]
  dropIds: string[]
}

export function withStartStep(steps: LoadingStep[], startLocation: string): LoadingStep[] {
  if (!steps.length) return []
  const first = steps[0]
  return [{
    nodeKey: '__start__',
    label: startLocation || first.label || 'START',
    code: '',
    region: '',
    trip: first.trip ?? 0,
    start: true,
    kind: 'load',
    boundFor: '',
    groupPos: 0,
    groupTotal: 0,
    lines: [],
    loadIds: [],
    dropIds: []
  }, ...steps]
}

interface ObjPool {
  contractId: string
  commodity: string
  boxes: Array<{ scuSize: number; count: number }>
}

// tell per contract from pool
function tellsForPool(pool: ObjPool[]): Map<string, string | null> {
  const tupleOwners = new Map<string, Set<string>>()
  const commodityOwners = new Map<string, Set<string>>()
  const add = (m: Map<string, Set<string>>, key: string, id: string): void => {
    const s = m.get(key) ?? new Set<string>()
    s.add(id)
    m.set(key, s)
  }
  const byContract = new Map<string, ObjPool[]>()
  for (const o of pool) {
    add(commodityOwners, o.commodity, o.contractId)
    for (const b of o.boxes) add(tupleOwners, `${o.commodity}|${b.scuSize}|${b.count}`, o.contractId)
    const arr = byContract.get(o.contractId) ?? []
    arr.push(o)
    byContract.set(o.contractId, arr)
  }

  const tells = new Map<string, string | null>()
  for (const [cid, objs] of byContract) {
    let best: { size: number; count: number; commodity: string } | null = null
    for (const o of objs) {
      for (const b of o.boxes) {
        const owners = tupleOwners.get(`${o.commodity}|${b.scuSize}|${b.count}`)
        if (owners && owners.size === 1) {
          if (!best || b.scuSize > best.size || (b.scuSize === best.size && b.count > best.count))
            best = { size: b.scuSize, count: b.count, commodity: o.commodity }
        }
      }
    }
    if (best) {
      tells.set(cid, tellLabel(best.commodity, best.size, best.count))
      continue
    }
    const uniqueCommodity = objs.map((o) => o.commodity).find((cm) => commodityOwners.get(cm)?.size === 1)
    tells.set(cid, uniqueCommodity ? `the only ${uniqueCommodity}` : null)
  }
  return tells
}

// scu aboard after each step plus the run's high-water mark; feeds the live
// load bar (fill = series[currentStep], tick = peak)
export function loadProfile(steps: LoadingStep[]): { series: number[]; peak: number } {
  const series: number[] = []
  let aboard = 0
  for (const s of steps) {
    const moved = s.lines.reduce((a, l) => a + l.scu, 0)
    aboard += s.kind === 'load' ? moved : -moved
    series.push(aboard)
  }
  return { series, peak: series.length ? Math.max(0, ...series) : 0 }
}

export function buildLoadingSteps(
  contracts: HaulingContract[],
  plan: RoutePlan,
  order: string[]
): LoadingStep[] {
  const base = buildRouteLoadingPlan(contracts, plan)
  const rank = new Map<string, number>()
  destinationsInOrder(contracts, order).forEach((d, i) => rank.set(d, i))

  const objInfo = new Map<string, ObjPool>()
  for (const c of activeContracts(contracts)) {
    for (const o of c.objectives) {
      objInfo.set(o.id, { contractId: c.id, commodity: o.commodity, boxes: o.boxes })
    }
  }

  const steps: LoadingStep[] = []
  for (const stop of base) {
    const common = { nodeKey: stop.nodeKey, label: stop.label, code: stop.code, region: stop.region, trip: stop.trip }
    if (stop.drops.length) {
      steps.push({
        ...common,
        kind: 'drop',
        boundFor: stop.label,
        groupPos: 0,
        groupTotal: 0,
        lines: stop.drops,
        loadIds: [],
        dropIds: stop.drops.map((l) => l.objectiveId)
      })
    }
    const byDest = new Map<string, RouteLoadLine[]>()
    for (const l of stop.loads) {
      const arr = byDest.get(l.destination) ?? []
      arr.push(l)
      byDest.set(l.destination, arr)
    }
    // deepest first, like the pack
    const dests = [...byDest.keys()].sort((a, b) => (rank.get(b) ?? -1) - (rank.get(a) ?? -1))
    const groups = dests.map((d) => byDest.get(d) as RouteLoadLine[])
    groups.forEach((lines, i) => {
      // tell from this group on
      const remaining = groups.slice(i).flat()
      const tells = tellsForPool(remaining.map((l) => objInfo.get(l.objectiveId)).filter((x): x is ObjPool => !!x))
      const lined = lines.map((l) => ({ ...l, tell: tells.get(l.contractId) ?? null }))
      steps.push({
        ...common,
        kind: 'load',
        boundFor: dests[i],
        groupPos: i + 1,
        groupTotal: groups.length,
        lines: lined,
        loadIds: lined.map((l) => l.objectiveId),
        dropIds: []
      })
    })
  }
  return steps
}

// a mid-walk come-back pulls the whole pickup out of the frozen walk: its load
// and drop steps vanish and the cargo waits for the next trip. ticked cargo is
// aboard, so it never filters. a grabbed pickup loads at its node's first visit
// instead of the planned return.
export function filterDeferredSteps(
  steps: LoadingStep[],
  deferred: ReadonlySet<string>,
  ticked: (objectiveId: string) => boolean,
  grabbed?: ReadonlySet<string>
): LoadingStep[] {
  if (!deferred.size && !grabbed?.size) return steps
  const gone = (id: string): boolean => deferred.has(id) && !ticked(id)
  const movedFrom = new Map<number, Set<string>>()
  const movedTo = new Map<number, LoadingStep['lines']>()
  if (grabbed?.size) {
    // grabs land on the last load step of the node's first visit, so they sit
    // at or ahead of where the user stood when they grabbed
    const target = new Map<string, number>()
    let i = 0
    while (i < steps.length) {
      let e = i
      let lastLoad = -1
      let open = false
      while (e < steps.length && steps[e].nodeKey === steps[i].nodeKey) {
        if (steps[e].kind === 'load') {
          lastLoad = e
          // a visit with all loads ticked is behind the walker; grabbed cargo
          // dropped there would be unreachable
          if (!steps[e].loadIds.length || steps[e].loadIds.some((id) => !ticked(id))) open = true
        }
        e++
      }
      if (lastLoad >= 0 && open && !target.has(steps[i].nodeKey)) target.set(steps[i].nodeKey, lastLoad)
      i = e
    }
    steps.forEach((s, j) => {
      if (s.kind !== 'load') return
      const to = target.get(s.nodeKey)
      if (to === undefined || to >= j) return
      for (const l of s.lines)
        if (grabbed.has(l.objectiveId)) {
          ;(movedFrom.get(j) ?? movedFrom.set(j, new Set()).get(j)!).add(l.objectiveId)
          ;(movedTo.get(to) ?? movedTo.set(to, []).get(to)!).push(l)
        }
    })
  }
  const out: LoadingStep[] = []
  steps.forEach((s, i) => {
    const away = movedFrom.get(i)
    const lines = s.lines.filter((l) => !gone(l.objectiveId) && !away?.has(l.objectiveId))
    // grabbed pickups join the visit as their own steps, one per destination;
    // lumping them into another group's step loads two groups in one tick
    const emitGrabbed = (): void => {
      const incoming = movedTo.get(i)
      if (!incoming?.length) return
      const byDest = new Map<string, LoadingStep['lines']>()
      for (const l of incoming) {
        const a = byDest.get(l.destination) ?? []
        a.push(l)
        byDest.set(l.destination, a)
      }
      for (const [dest, ls] of byDest)
        out.push({ ...s, kind: 'load', boundFor: dest, groupPos: 0, groupTotal: 0, lines: ls, loadIds: ls.map((l) => l.objectiveId), dropIds: [] })
    }
    // a step that lost all its lines drops out; a born-empty step (step 0) stays
    if (!lines.length && s.lines.length) {
      emitGrabbed()
      return
    }
    if (lines.length === s.lines.length && !away) out.push(s)
    else
      out.push({
        ...s,
        lines,
        loadIds: s.loadIds.filter((id) => !gone(id) && !away?.has(id)),
        dropIds: s.dropIds.filter((id) => !gone(id))
      })
    emitGrabbed()
  })
  return out
}

// drops lag a step
export function buildLoadEvents(loadSteps: LoadingStep[], source: PackBox[]): LoadEvent[] {
  const pool = new Map<string, PackBox[]>()
  for (const b of source) {
    const arr = pool.get(b.objectiveId!) ?? []
    arr.push(b)
    pool.set(b.objectiveId!, arr)
  }
  for (const arr of pool.values()) arr.sort((a, b) => b.size - a.size)
  const aboard = new Map<string, Set<string>>()
  // exact sizes, match the breakdown
  const take = (objId: string, sizes: number[]): PackBox[] => {
    const have = aboard.get(objId) ?? new Set<string>()
    const avail = pool.get(objId) ?? []
    const got: PackBox[] = []
    for (const sz of [...sizes].sort((a, b) => b - a)) {
      const b = avail.find((x) => x.size === sz && !have.has(x.id))
      if (b) {
        have.add(b.id)
        got.push(b)
      }
    }
    aboard.set(objId, have)
    return got
  }
  const release = (objId: string, scu: number): string[] => {
    const have = aboard.get(objId)
    if (!have) return []
    const gone: string[] = []
    let acc = 0
    for (const b of pool.get(objId) ?? []) {
      if (!have.has(b.id) || acc >= scu) continue
      have.delete(b.id)
      gone.push(b.id)
      acc += b.size
    }
    return gone
  }
  const events: LoadEvent[] = []
  let pendingDrop: string[] = []
  for (const s of loadSteps) {
    const load = s.kind === 'load' ? s.lines.flatMap((l) => take(l.objectiveId, l.loadBoxes)) : []
    events.push({ load, drop: pendingDrop })
    pendingDrop = s.kind === 'drop' ? s.lines.flatMap((l) => release(l.objectiveId, l.scu)) : []
  }
  return events
}
