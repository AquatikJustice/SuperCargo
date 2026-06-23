// Loading Mode plan: walk the solved ROUTE one stop at a time and, at each stop,
// tell the user what to LOAD here (the legs whose cargo is collected at this stop)
// and what to UNLOAD here (deliveries that drop here). Cargo can be picked up in
// several places, so loading interleaves with delivery - this follows the route
// order instead of assuming one load session.
//
// Each line leads with a "tell": the one stack unique to its contract among all
// active contracts, so you can pick the right look-alike freight-elevator mission.

import type { HaulingContract } from '@shared/types'
import { boxBreakdown } from '@shared/box'
import { activeContracts } from './manifest'
import type { RoutePlan } from './route'

const undelivered = (c: HaulingContract): HaulingContract['objectives'] =>
  c.objectives.filter((o) => !o.delivered)

/** Format a (commodity,size,count) tell, e.g. "5x 16 SCU Titanium Ore". */
const tellLabel = (commodity: string, size: number, count: number): string =>
  `${count}× ${size} SCU ${commodity}`

/**
 * For each active contract, the single most distinctive thing to look for in the
 * freight elevator: a (commodity, box-size, count) stack no other active contract
 * has, else a commodity only it carries, else null (genuinely ambiguous).
 */
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
  /** contract ref, to match the freight-elevator mission. */
  ref: string
  /** the unique-among-active stack used to FIND this contract in the FE. */
  tell: string | null
  commodity: string
  scu: number
  /** e.g. "5x16 + 1x4". */
  breakdown: string
  /** where this cargo is going. */
  destination: string
  /** true when the delivery loads from more than one pickup (load what's here). */
  multiPickup: boolean
  objectiveId: string
}

export interface RouteLoadStop {
  nodeKey: string
  label: string
  code: string
  region: string
  /** cargo to load at this stop. */
  loads: RouteLoadLine[]
  /** cargo to unload at this stop. */
  drops: RouteLoadLine[]
  /** SCU aboard after this stop. */
  loadAfter: number
  /** objectives touched here, for the 3D highlight. */
  objectiveIds: string[]
}

/** Turn the solved route into a load/unload walkthrough. */
export function buildRouteLoadingPlan(
  contracts: HaulingContract[],
  plan: RoutePlan
): RouteLoadStop[] {
  const tells = distinctiveTells(contracts)
  const byObjective = new Map(
    activeContracts(contracts).flatMap((c) => c.objectives.map((o) => [o.id, { c, o }] as const))
  )
  const lineFor = (objectiveId: string): RouteLoadLine | null => {
    const found = byObjective.get(objectiveId)
    if (!found) return null
    const { c, o } = found
    return {
      ref: c.ref,
      tell: tells.get(c.id) ?? null,
      commodity: o.commodity,
      scu: o.scuAmount,
      breakdown: boxBreakdown(o.boxes),
      destination: o.destination,
      multiPickup: (o.pickups?.length ?? 0) > 1,
      objectiveId: o.id
    }
  }

  const stops: RouteLoadStop[] = []
  for (const s of plan.steps) {
    const loads = s.loadRefs.map((r) => lineFor(r.objectiveId)).filter((l): l is RouteLoadLine => !!l)
    const drops = s.dropRefs.map((r) => lineFor(r.objectiveId)).filter((l): l is RouteLoadLine => !!l)
    if (!loads.length && !drops.length) continue
    stops.push({
      nodeKey: s.nodeKey,
      label: s.label,
      code: s.code,
      region: s.region,
      loads,
      drops,
      loadAfter: s.loadAfter,
      objectiveIds: [...new Set([...loads, ...drops].map((l) => l.objectiveId))]
    })
  }
  return stops
}
