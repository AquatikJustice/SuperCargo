import type { HaulingContract } from '@shared/types'
import { boxBreakdown, calculateBoxes, boxList, listBreakdown } from '@shared/box'
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
