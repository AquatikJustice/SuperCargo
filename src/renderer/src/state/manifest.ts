// Pure derivation helpers turning the contract list into the grouped views the
// UI renders. No React/zustand here so it stays trivially testable.

import type { HaulingContract, HistoryEntry, HistoryStatus } from '@shared/types'
import { boxBreakdown, boxCount, boxList } from '@shared/box'
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
  /** Per-leg pickups, when this objective loads somewhere other than the contract's. */
  pickups?: string[]
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
  /** SCU turned in so far (undefined = not marked -> counts as a full turn-in). */
  deliveredScu?: number
  /** Per-leg pickups, when this objective loads somewhere other than the contract's. */
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

/** A contract is HELD while it awaits its first OCR capture (pendingOcr): we
 *  already have its log data, but it's kept out of sight so it isn't shown twice
 *  - once here and once in the capture modal that's open over it. It's still in
 *  the store (so the capture can merge into it) and surfaces the moment the
 *  capture is submitted or dismissed. Every contract thus follows one flow:
 *  accept -> (capture) -> appears. */
export const isHeld = (c: HaulingContract): boolean => !!c.pendingOcr

export const activeContracts = (contracts: HaulingContract[]): HaulingContract[] =>
  contracts.filter((c) => c.status === 'active' && !isHeld(c))

/** Distinct destinations across active contracts, in the order requested. */
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
      hasElevator: split.hasElevator,
      items,
      totSCU,
      totBoxes,
      totContracts
    }
  })
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

/** Snapshot a finished contract into a history entry (totals computed once). */
export function toHistoryEntry(
  c: HaulingContract,
  status: HistoryStatus,
  runId: string,
  endedAt: string
): HistoryEntry {
  const destinations = [...new Set(c.objectives.map((o) => o.destination))]
  const totalScu = c.objectives.reduce((a, o) => a + o.scuAmount, 0)
  // How much was actually turned in. A completion with nothing explicitly marked
  // is assumed FULL (you submitted the whole contract); an abandon/fail with
  // nothing marked delivered nothing. An explicit deliveredScu always wins.
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

/** Box list shaped for the Phase 4 3D packer (carries stop index + commodity). */
export function packBoxes(
  contracts: HaulingContract[],
  order: string[]
): Array<{
  id: string
  size: number
  color: string
  dest: string
  commodity: string
  stopIdx: number
  objectiveId: string
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
  }> = []
  let n = 0
  for (const stop of stops) {
    for (const c of live) {
      for (const o of c.objectives) {
        if (o.destination !== stop.destination) continue
        if (o.delivered) continue // delivered cargo is off the ship - don't lay it out
        for (const size of boxList(o.boxes)) {
          out.push({
            id: `pk-${n++}`,
            size,
            color: stop.color,
            dest: stop.code || stop.name,
            commodity: o.commodity,
            stopIdx: stop.idx,
            objectiveId: o.id
          })
        }
      }
    }
  }
  return out
}
