// per-stop load/unload walkthrough

import type { HaulingContract } from '@shared/types'
import { boxBreakdown } from '@shared/box'
import { activeContracts } from './manifest'
import type { RoutePlan } from './route'

const undelivered = (c: HaulingContract): HaulingContract['objectives'] =>
  c.objectives.filter((o) => !o.delivered)

const tellLabel = (commodity: string, size: number, count: number): string =>
  `${count}× ${size} SCU ${commodity}`

// distinctive tell per contract, else null
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
  scu: number
  breakdown: string
  destination: string
  multiPickup: boolean
  objectiveId: string
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
}

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
