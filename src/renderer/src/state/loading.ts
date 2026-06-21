// Loading Mode plan: walk the haul one destination at a time and, for each, tell
// the user exactly which boxes to pull from the freight elevator, grouped by
// contract (the freight elevator groups cargo by contract). Each contract leads
// with a "tell": the one stack that is unique to it among all active contracts,
// so you can pick the right look-alike mission without counting the whole set.

import type { HaulingContract, BoxAllocation } from '@shared/types'
import { boxBreakdown, boxCount, boxScu } from '@shared/box'
import { activeContracts, deriveStops } from './manifest'

export interface LoadStack {
  commodity: string
  boxes: BoxAllocation[]
  scu: number
  /** e.g. "5x16 + 1x4". */
  breakdown: string
}

export interface LoadGroup {
  contractId: string
  ref: string
  title: string
  /** the unique-among-active stack/commodity used to FIND this contract in the FE. */
  tell: string | null
  stacks: LoadStack[]
}

export interface LoadStop {
  destination: string
  /** stop index = the 3D grid section id (placement.box.stopIdx). */
  idx: number
  code: string
  name: string
  groups: LoadGroup[]
  boxCount: number
  scu: number
}

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
    // best unique (commodity,size,count) tuple: prefer the biggest box, then count
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
    // else a commodity unique to this contract
    const uniqueCommodity = undelivered(c)
      .map((o) => o.commodity)
      .find((cm) => commodityOwners.get(cm)?.size === 1)
    tells.set(c.id, uniqueCommodity ? `the only ${uniqueCommodity}` : null)
  }
  return tells
}

/** Build the per-destination loading plan, ordered for loading (last delivery
 *  first, so the first drop-off ends up nearest the ramp / on top). */
export function buildLoadingPlan(contracts: HaulingContract[], order: string[]): LoadStop[] {
  const stops = deriveStops(contracts, order)
  const tells = distinctiveTells(contracts)
  const live = activeContracts(contracts)

  const result: LoadStop[] = []
  for (const stop of stops) {
    const groups: LoadGroup[] = []
    for (const c of live) {
      const stacks: LoadStack[] = []
      for (const o of c.objectives) {
        if (o.delivered || o.destination !== stop.destination) continue
        stacks.push({
          commodity: o.commodity,
          boxes: o.boxes,
          scu: o.scuAmount,
          breakdown: boxBreakdown(o.boxes)
        })
      }
      if (stacks.length)
        groups.push({ contractId: c.id, ref: c.ref, title: c.title, tell: tells.get(c.id) ?? null, stacks })
    }
    if (!groups.length) continue
    const boxes = groups.flatMap((g) => g.stacks.flatMap((s) => s.boxes))
    result.push({
      destination: stop.destination,
      idx: stop.idx,
      code: stop.code,
      name: stop.name,
      groups,
      boxCount: boxCount(boxes),
      scu: boxScu(boxes)
    })
  }
  // load order: last delivery first, so the first delivery ends up accessible
  return result.sort((a, b) => b.idx - a.idx)
}
