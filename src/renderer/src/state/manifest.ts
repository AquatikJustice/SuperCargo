// no react/zustand, keeps it testable

import type { HaulingContract, HistoryEntry, HistoryStatus } from '@shared/types'
import type { RoutePlan } from './route'
import { boxBreakdown, boxCount, boxList, listBreakdown } from '@shared/box'
import { payoutFactor, snapPayout } from '@shared/payout'
import { splitDestination } from '../data/stations'
import { stopColor } from '../theme'

export interface StopItem {
  objectiveId: string
  contractId: string
  ref: string
  scu: number
  commodity: string
  boxStr: string
  boxCount: number
  delivered: boolean
  /** undefined = not turned in */
  turnedInScu?: number
  /** loads elsewhere than contract pickup */
  pickups?: string[]
}

export interface PickupItem {
  objectiveId: string
  contractId: string
  ref: string
  commodity: string
  scu: number
  boxStr: string
  boxCount: number
  destination: string
  /** loads from multiple places */
  split: boolean
  /** pickup stop's node key */
  pickupKey?: string
  /** checked off as collected here */
  picked?: boolean
}

export interface Stop {
  destination: string
  idx: number
  n: string
  code: string
  name: string
  region: string
  color: string
  hasElevator?: boolean
  items: StopItem[]
  totSCU: number
  totBoxes: number
  totContracts: number
  /** cargo picked up here */
  pickups?: PickupItem[]
  /** pickup only, no delivery */
  pickupOnly?: boolean
  /** run start, always first */
  start?: boolean
  /** node key, for reordering */
  nodeKey?: string
}

export interface DerivedContractObjective {
  objectiveId: string
  scu: number
  commodity: string
  destination: string
  destCode: string
  boxStr: string
  boxCount: number
  delivered: boolean
  /** undefined = full turn-in */
  deliveredScu?: number
  /** undefined = not turned in */
  turnedInScu?: number
  /** loads elsewhere than contract pickup */
  pickups?: string[]
}

export interface DerivedContract {
  id: string
  ref: string
  title: string
  rank: string
  haulType: string
  pickup: string
  reward: number
  maxBox: number
  status: string
  acceptedAt: string
  objectives: DerivedContractObjective[]
  objCount: number
  totSCU: number
  blueprint: boolean
  blueprints: string[]
  reputation?: number
}

// hidden while capture modal open
export const isHeld = (c: HaulingContract): boolean => !!c.pendingOcr

export const activeContracts = (contracts: HaulingContract[]): HaulingContract[] =>
  contracts.filter((c) => c.status === 'active' && !isHeld(c))

export function destinationsInOrder(contracts: HaulingContract[], order: string[]): string[] {
  const present = new Set<string>()
  for (const c of activeContracts(contracts)) {
    for (const o of c.objectives) present.add(o.destination)
  }
  const ordered = order.filter((d) => present.has(d))
  for (const d of present) if (!ordered.includes(d)) ordered.push(d)
  return ordered
}

export function deriveStops(contracts: HaulingContract[], order: string[]): Stop[] {
  const dests = destinationsInOrder(contracts, order)
  const live = activeContracts(contracts)

  return dests.map((destination, idx) => {
    const split = splitDestination(destination)
    const items: StopItem[] = []
    for (const c of live) {
      for (const o of c.objectives) {
        if (o.destination !== destination) continue
        items.push({
          objectiveId: o.id,
          contractId: c.id,
          ref: c.ref,
          scu: o.scuAmount,
          commodity: o.commodity,
          boxStr: boxBreakdown(o.boxes),
          boxCount: boxCount(o.boxes),
          delivered: o.delivered,
          turnedInScu: o.turnedInScu,
          pickups: o.pickups
        })
      }
    }
    const totSCU = items.reduce((a, i) => a + i.scu, 0)
    const totBoxes = items.reduce((a, i) => a + i.boxCount, 0)
    const totContracts = new Set(items.map((i) => i.contractId)).size
    return {
      destination,
      idx,
      n: String(idx + 1).padStart(2, '0'),
      code: split.code,
      name: split.name,
      region: split.region,
      color: stopColor(idx),
      items,
      totSCU,
      totBoxes,
      totContracts
    }
  })
}

const normLoc = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function deriveStopsWithPickups(
  contracts: HaulingContract[],
  order: string[],
  startLocation?: string
): Stop[] {
  const stops = deriveStops(contracts, order)
  const live = activeContracts(contracts)
  const startKey = startLocation ? normLoc(startLocation) : ''

  const groups = new Map<string, { name: string; items: PickupItem[] }>()
  for (const c of live) {
    for (const o of c.objectives) {
      if (o.delivered) continue
      const locs = o.pickups && o.pickups.length ? o.pickups : c.pickup ? [c.pickup] : []
      // dedupe repeated terminals
      const byKey = new Map<string, string>()
      for (const pu of locs) {
        const k = normLoc(pu)
        if (k && !byKey.has(k)) byKey.set(k, pu)
      }
      const item: PickupItem = {
        objectiveId: o.id,
        contractId: c.id,
        ref: c.ref,
        commodity: o.commodity,
        scu: o.scuAmount,
        boxStr: boxBreakdown(o.boxes),
        boxCount: boxCount(o.boxes),
        destination: o.destination,
        split: byKey.size > 1
      }
      for (const [key, name] of byKey) {
        const g = groups.get(key) ?? { name, items: [] }
        g.items.push(item)
        groups.set(key, g)
      }
    }
  }

  // start can't double as delivery
  let startStop: Stop | null = null
  if (startKey) {
    const g = groups.get(startKey)
    if (g) groups.delete(startKey)
    const split = splitDestination(startLocation as string)
    startStop = {
      destination: startLocation as string,
      idx: -1,
      n: '↑',
      code: split.code,
      name: split.name || (startLocation as string),
      region: split.region,
      color: '#5fd089',
      items: [],
      totSCU: 0,
      totBoxes: 0,
      totContracts: 0,
      pickups: g ? g.items : [],
      pickupOnly: true,
      start: true
    }
  }

  // own card per pickup visit
  const pos = new Map<string, number>()
  stops.forEach((s, i) => pos.set(normLoc(s.destination), i))
  const extras: Array<{ at: number; stop: Stop }> = []
  for (const [, g] of groups) {
    const at = Math.min(...g.items.map((it) => pos.get(normLoc(it.destination)) ?? stops.length))
    const split = splitDestination(g.name)
    extras.push({
      at,
      stop: {
        destination: g.name,
        idx: -1,
        n: '↑',
        code: split.code,
        name: split.name || g.name,
        region: split.region,
        color: '#5fd089',
        items: [],
        totSCU: 0,
        totBoxes: 0,
        totContracts: 0,
        pickups: g.items,
        pickupOnly: true
      }
    })
  }
  const out: Stop[] = []
  for (let i = 0; i < stops.length; i++) {
    for (const e of extras) if (e.at === i) out.push(e.stop)
    out.push(stops[i])
  }
  for (const e of extras) if (e.at >= stops.length) out.push(e.stop)
  if (startStop) out.unshift(startStop)
  return out
}

// one card per route visit
export function deriveRouteStops(
  contracts: HaulingContract[],
  route: RoutePlan,
  order: string[]
): Stop[] {
  type Obj = HaulingContract['objectives'][number]
  const byObjective = new Map<string, { c: HaulingContract; o: Obj }>()
  for (const c of activeContracts(contracts)) for (const o of c.objectives) byObjective.set(o.id, { c, o })
  // colour by destination slot
  const dests = destinationsInOrder(contracts, order)
  const colorOf = (dest: string): string => stopColor(Math.max(0, dests.indexOf(dest)))

  const out: Stop[] = []
  let deliveryNo = 0
  for (const step of route.steps) {
    const items: StopItem[] = []
    const dropSeen = new Set<string>()
    for (const r of step.dropRefs) {
      if (dropSeen.has(r.objectiveId)) continue
      dropSeen.add(r.objectiveId)
      const f = byObjective.get(r.objectiveId)
      if (!f) continue
      const boxes = r.boxes ?? boxList(f.o.boxes)
      items.push({
        objectiveId: r.objectiveId,
        contractId: f.c.id,
        ref: f.c.ref,
        scu: r.scu,
        commodity: f.o.commodity,
        boxStr: listBreakdown(boxes),
        boxCount: boxes.length,
        delivered: f.o.delivered,
        turnedInScu: f.o.turnedInScu,
        pickups: f.o.pickups
      })
    }
    const pickups: PickupItem[] = []
    const loadSeen = new Set<string>()
    for (const r of step.loadRefs) {
      if (loadSeen.has(r.objectiveId)) continue
      loadSeen.add(r.objectiveId)
      const f = byObjective.get(r.objectiveId)
      if (!f) continue
      const boxes = r.boxes ?? boxList(f.o.boxes)
      pickups.push({
        objectiveId: r.objectiveId,
        contractId: f.c.id,
        ref: f.c.ref,
        commodity: f.o.commodity,
        scu: r.scu,
        boxStr: listBreakdown(boxes),
        boxCount: boxes.length,
        destination: f.o.destination,
        split: (f.o.pickups?.length ?? 0) > 1,
        pickupKey: step.nodeKey,
        picked: (f.o.pickedUpAt ?? []).includes(step.nodeKey)
      })
    }
    if (!items.length && !pickups.length) continue
    const pickupOnly = items.length === 0
    if (!pickupOnly) deliveryNo++
    const split = splitDestination(step.label)
    const firstDrop = items[0] ? byObjective.get(items[0].objectiveId)?.o.destination : undefined
    out.push({
      destination: step.label,
      idx: out.length,
      nodeKey: step.nodeKey,
      n: pickupOnly ? '↑' : String(deliveryNo).padStart(2, '0'),
      code: step.code || split.code,
      name: split.name || step.label,
      region: step.region || split.region,
      color: pickupOnly ? '#5fd089' : colorOf(firstDrop ?? step.label),
      items,
      totSCU: items.reduce((a, i) => a + i.scu, 0),
      totBoxes: items.reduce((a, i) => a + i.boxCount, 0),
      totContracts: new Set(items.map((i) => i.contractId)).size,
      pickups,
      pickupOnly,
      start: step.nodeKey === 'depot'
    })
  }
  return out
}

export function deriveContracts(contracts: HaulingContract[]): DerivedContract[] {
  return contracts.map((c) => {
    const objectives = c.objectives.map((o) => {
      const split = splitDestination(o.destination)
      return {
        objectiveId: o.id,
        scu: o.scuAmount,
        commodity: o.commodity,
        destination: o.destination,
        destCode: split.code || split.name,
        boxStr: boxBreakdown(o.boxes),
        boxCount: boxCount(o.boxes),
        delivered: o.delivered,
        deliveredScu: o.deliveredScu,
        turnedInScu: o.turnedInScu,
        pickups: o.pickups
      }
    })
    return {
      id: c.id,
      ref: c.ref,
      title: c.title,
      rank: c.rank,
      haulType: c.haulType,
      pickup: c.pickup,
      reward: c.reward,
      maxBox: c.maxBoxSize,
      status: c.status,
      acceptedAt: c.acceptedAt,
      objectives,
      objCount: objectives.length,
      totSCU: objectives.reduce((a, o) => a + o.scu, 0),
      blueprint: !!c.blueprint,
      blueprints: c.blueprints ?? [],
      reputation: c.reputation
    }
  })
}

export interface ManifestTotals {
  scu: number
  boxes: number
  dests: number
  contracts: number
}

export function deriveTotals(stops: Stop[], contracts: HaulingContract[]): ManifestTotals {
  return {
    scu: stops.reduce((a, s) => a + s.totSCU, 0),
    boxes: stops.reduce((a, s) => a + s.totBoxes, 0),
    dests: stops.length,
    contracts: activeContracts(contracts).length
  }
}

export function toHistoryEntry(
  c: HaulingContract,
  status: HistoryStatus,
  runId: string,
  endedAt: string
): HistoryEntry {
  const destinations = [...new Set(c.objectives.map((o) => o.destination))]
  const totalScu = c.objectives.reduce((a, o) => a + o.scuAmount, 0)
  // unmarked: completed full, abandon zero
  const deliveredScu = c.objectives.reduce(
    (a, o) => a + (o.deliveredScu ?? (status === 'completed' ? o.scuAmount : 0)),
    0
  )
  const completionPct =
    totalScu > 0 ? Math.min(1, deliveredScu / totalScu) : status === 'completed' ? 1 : 0
  const payout = snapPayout(c.reward * payoutFactor(completionPct))
  return {
    id: c.id,
    ref: c.ref,
    title: c.title,
    rank: c.rank,
    haulType: c.haulType,
    pickup: c.pickup,
    reward: c.reward,
    totalScu,
    totalBoxes: c.objectives.reduce((a, o) => a + boxCount(o.boxes), 0),
    destinations,
    objectiveCount: c.objectives.length,
    status,
    completionPct,
    payout,
    acceptedAt: c.acceptedAt,
    endedAt,
    runId,
    dataSource: c.dataSource
  }
}

export function packBoxes(
  contracts: HaulingContract[],
  order: string[],
  includeDelivered = false
): Array<{
  id: string
  size: number
  color: string
  dest: string
  commodity: string
  stopIdx: number
  objectiveId: string
  bucketId: string
  /** ordinal within its objective */
  slot: number
}> {
  const stops = deriveStops(contracts, order)
  const live = activeContracts(contracts)
  const out: Array<{
    id: string
    size: number
    color: string
    dest: string
    commodity: string
    stopIdx: number
    objectiveId: string
    bucketId: string
    slot: number
  }> = []
  let n = 0
  for (const stop of stops) {
    for (const c of live) {
      for (const o of c.objectives) {
        if (o.destination !== stop.destination) continue
        if (o.delivered && !includeDelivered) continue // already off the ship
        let slot = 0
        for (const size of boxList(o.boxes)) {
          out.push({
            id: `pk-${n++}`,
            size,
            color: stop.color,
            dest: stop.code || stop.name,
            commodity: o.commodity,
            stopIdx: stop.idx,
            objectiveId: o.id,
            bucketId: o.id,
            slot: slot++
          })
        }
      }
    }
  }
  return out
}
