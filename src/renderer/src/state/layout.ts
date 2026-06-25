// frozen: never move a placed box

import type { HaulingContract, DeliveryObjective, CargoLayout, FrozenBox } from '@shared/types'
import { boxList } from '@shared/box'
import { packInto, type Occupied } from '@shared/packer'
import type { CargoGrid } from '@shared/cargoGrids'
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

// run the packer once and stamp each box's resting position onto it
function stampPositions(boxes: FrozenBox[], occupied: Occupied[], grids: CargoGrid[]): void {
  const fresh = occupied.length ? boxes.filter((b) => b.x == null) : boxes
  const { placements } = packInto(grids, occupied, fresh)
  const pos = new Map(placements.map((p) => [p.box.id, p]))
  for (const b of fresh) {
    const p = pos.get(b.id)
    if (p) Object.assign(b, { gridId: p.gridId, x: p.x, y: p.y, z: p.z, w: p.w, l: p.l, h: p.h, rotated: p.rotated })
  }
}

const occupiedFrom = (boxes: FrozenBox[]): Occupied[] =>
  boxes
    .filter((b) => b.gridId != null && b.x != null)
    .map((b) => ({ gridId: b.gridId!, x: b.x!, y: b.y!, z: b.z!, w: b.w!, l: b.l!, h: b.h!, stopIdx: b.stopIdx }))

export function snapshotLayout(
  contracts: HaulingContract[],
  order: string[],
  grids: CargoGrid[]
): CargoLayout {
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
  stampPositions(boxes, [], grids)
  return { locked: true, boxes }
}

// reflag + append, never move what's already placed
export function reconcileLayout(
  contracts: HaulingContract[],
  layout: CargoLayout,
  grids: CargoGrid[]
): CargoLayout {
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
  const fresh: FrozenBox[] = []
  for (const c of activeContracts(contracts)) {
    for (const o of c.objectives) {
      if (o.delivered || seen.has(`${c.id}:${o.id}`)) continue
      let stopIdx = newStop.get(o.destination)
      if (stopIdx === undefined) {
        stopIdx = ++maxStop
        newStop.set(o.destination, stopIdx)
      }
      fresh.push(...boxesFor(c, o, stopIdx, stopColor(stopIdx)))
    }
  }
  boxes.push(...fresh)
  // slot late additions (and migrate any position-less legacy boxes) into the
  // gaps, leaving already-placed cargo untouched
  if (boxes.some((b) => b.x == null)) {
    stampPositions(boxes, occupiedFrom(boxes), grids)
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
