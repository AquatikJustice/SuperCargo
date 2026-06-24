// frozen: never move a placed box

import type { HaulingContract, DeliveryObjective, CargoLayout, FrozenBox } from '@shared/types'
import { boxList } from '@shared/box'
import { splitDestination } from '../data/stations'
import { stopColor } from '../theme'
import { activeContracts, destinationsInOrder } from './manifest'

function boxesFor(
  c: HaulingContract,
  o: DeliveryObjective,
  stopIdx: number,
  color: string
): FrozenBox[] {
  const split = splitDestination(o.destination)
  return boxList(o.boxes).map((size, n) => ({
    id: `${c.id}:${o.id}:${n}`,
    size,
    color,
    dest: split.code || split.name,
    commodity: o.commodity,
    stopIdx,
    contractId: c.id,
    objectiveId: o.id,
    destination: o.destination,
    delivered: false
  }))
}

export function snapshotLayout(contracts: HaulingContract[], order: string[]): CargoLayout {
  const dests = destinationsInOrder(contracts, order)
  const idxOf = new Map(dests.map((d, i) => [d, i]))
  const boxes: FrozenBox[] = []
  for (const c of activeContracts(contracts)) {
    for (const o of c.objectives) {
      if (o.delivered) continue
      const stopIdx = idxOf.get(o.destination)
      if (stopIdx === undefined) continue
      boxes.push(...boxesFor(c, o, stopIdx, stopColor(stopIdx)))
    }
  }
  return { locked: true, boxes }
}

// reflag + append, never move existing
export function reconcileLayout(contracts: HaulingContract[], layout: CargoLayout): CargoLayout {
  const byId = new Map(activeContracts(contracts).map((c) => [c.id, c]))

  const boxes: FrozenBox[] = layout.boxes.map((b) => {
    const c = byId.get(b.contractId)
    const o = c?.objectives.find((x) => x.id === b.objectiveId)
    const delivered = !c || !o || o.delivered
    return delivered === b.delivered ? b : { ...b, delivered }
  })

  const seen = new Set(boxes.map((b) => `${b.contractId}:${b.objectiveId}`))
  let maxStop = boxes.reduce((m, b) => Math.max(m, b.stopIdx), -1)
  const newStop = new Map<string, number>()
  for (const c of activeContracts(contracts)) {
    for (const o of c.objectives) {
      if (o.delivered || seen.has(`${c.id}:${o.id}`)) continue
      let stopIdx = newStop.get(o.destination)
      if (stopIdx === undefined) {
        stopIdx = ++maxStop
        newStop.set(o.destination, stopIdx)
      }
      boxes.push(...boxesFor(c, o, stopIdx, stopColor(stopIdx)))
    }
  }

  return { locked: layout.locked, boxes }
}

export interface LayoutStop {
  idx: number
  destination: string
  code: string
  name: string
  color: string
  total: number
  undelivered: number
  refs: Array<{ contractId: string; objectiveId: string }>
}

export function layoutStops(layout: CargoLayout): LayoutStop[] {
  const byIdx = new Map<number, LayoutStop>()
  for (const b of layout.boxes) {
    let s = byIdx.get(b.stopIdx)
    if (!s) {
      const split = splitDestination(b.destination)
      s = {
        idx: b.stopIdx,
        destination: b.destination,
        code: split.code,
        name: split.name || b.dest,
        color: b.color,
        total: 0,
        undelivered: 0,
        refs: []
      }
      byIdx.set(b.stopIdx, s)
    }
    s.total++
    if (!b.delivered) s.undelivered++
    const ref = { contractId: b.contractId, objectiveId: b.objectiveId }
    if (!s.refs.some((r) => r.contractId === ref.contractId && r.objectiveId === ref.objectiveId))
      s.refs.push(ref)
  }
  return [...byIdx.values()].sort((a, b) => a.idx - b.idx)
}
