import type { HaulingContract, Location } from '@shared/types'
import { planRoute, type RouteJob, type RouteResult } from '@shared/route'
import type { CargoGrid } from '@shared/cargoGrids'
import { boxList } from '@shared/box'
import { splitDestination } from '../data/stations'
import { activeContracts } from './manifest'

export interface RouteNode {
  key: string
  label: string
  code: string
  region: string
  uexId?: number
  /** undefined => unmatched */
  x?: number
  y?: number
  z?: number
  system?: string
  destStrings: string[]
}

interface JobInfo {
  pickupNode: number
  destNode: number
  scu: number
  /** real box sizes loaded here */
  boxes: number[]
  commodity: string
  contractId: string
  objectiveId: string
}

export interface StepRef {
  contractId: string
  objectiveId: string
  /** scu moved this step */
  scu: number
  /** absent on older models */
  boxes?: number[]
}

export interface RouteModel {
  nodes: RouteNode[]
  jobs: RouteJob[]
  jobInfo: JobInfo[]
  depot?: number
}

export interface RouteLegItem {
  commodity: string
  scu: number
  /** other end of leg */
  other: string
}

export interface RouteStep {
  nodeKey: string
  label: string
  code: string
  region: string
  pickups: RouteLegItem[]
  drops: RouteLegItem[]
  loadRefs: StepRef[]
  dropRefs: StepRef[]
  /** left for a return pass */
  deferRefs: StepRef[]
  loadAfter: number
  /** 0-based trip */
  trip: number
}

export interface RoutePlan {
  steps: RouteStep[]
  destOrder: string[]
  /** stops in visit order, reorderable */
  stopKeys: string[]
  totalDistance: number
  feasible: boolean
  peakLoad: number
  capacity: number
  /** hold-fulls, >1 means revisits */
  trips: number
  /** scu aboard after first stop */
  startLoad: number
  /** first stop name */
  startStop: string
  method: RouteResult['method']
  reason?: string
  /** real distance vs grouping fallback */
  usedRealDistance: boolean
  /** scu aboard at trip 0's peak */
  trip1Scu: Record<string, number>
  /** objectives that matched a job */
  matchedObjectives: string[]
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// city to LEO overhead
const CITY_LEO: Record<string, string> = {
  area18: 'Baijini Point',
  'riker memorial spaceport': 'Baijini Point',
  lorville: 'Everus Harbor',
  'teasa spaceport': 'Everus Harbor',
  'new babbage': 'Port Tressler',
  'new babbage interstellar spaceport': 'Port Tressler',
  'nb int spaceport': 'Port Tressler',
  orison: 'Seraphim Station',
  'august dunlow spaceport': 'Seraphim Station'
}

// spaceports lack coords, borrow LEO's
function withCityCoords(locations: Location[]): Location[] {
  return locations.map((l) => {
    if (typeof l.x === 'number') return l
    const leoName = CITY_LEO[norm(l.name)]
    if (!leoName) return l
    const leo = locations.find((p) => norm(p.name) === norm(leoName) && typeof p.x === 'number')
    return leo ? { ...l, x: leo.x, y: leo.y, z: leo.z, system: l.system ?? leo.system } : l
  })
}

export function matchLocation(raw: string, locations: Location[]): Location | null {
  if (!raw || !locations.length) return null
  const split = splitDestination(raw)
  const code = split.code.toLowerCase()
  if (code) {
    const byCode = locations.find((l) => l.code.toLowerCase() === code)
    if (byCode) return byCode
  }
  const n = norm(raw)
  const byExact = locations.find((l) => norm(l.name) === n || norm(l.code) === n)
  if (byExact) return byExact
  // one name contains the other
  const byContains = locations.find((l) => {
    const ln = norm(l.name)
    return ln.includes(n) || n.includes(ln)
  })
  return byContains ?? null
}

/** system prefix from a code */
function systemOf(code: string): string {
  const m = /^([A-Za-z]{3})\b/.exec(code)
  return m ? m[1].toUpperCase() : ''
}

interface Pos {
  x: number
  y: number
  z: number
  system: string
}
function hasPos(n: { x?: number; system?: string }): n is Pos & typeof n {
  return typeof n.x === 'number' && typeof n.system === 'string'
}
/** gigameters, coords in meters */
function dist3(a: Pos, b: Pos): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / 1e9
}
/** gateway stations per system */
function gatewaysBySystem(locations: Location[]): Map<string, Pos[]> {
  const m = new Map<string, Pos[]>()
  for (const l of locations) {
    if (!hasPos(l) || !/gateway/i.test(l.name)) continue
    const arr = m.get(l.system) ?? []
    arr.push(l)
    m.set(l.system, arr)
  }
  return m
}

/** uex id, else name + system */
function sameLoc(a: Location | null, b: Location | null): boolean {
  if (!a || !b) return false
  if (a.uexId && b.uexId) return a.uexId === b.uexId
  return norm(a.name) === norm(b.name) && (a.system ?? '') === (b.system ?? '')
}

// split oversized bucket to fit
function chunkToCapacity(boxes: number[], cap: number): number[][] {
  const sorted = [...boxes].sort((a, b) => b - a)
  const bins: number[][] = []
  const sums: number[] = []
  for (const b of sorted) {
    let placed = false
    for (let i = 0; i < bins.length; i++) {
      if (sums[i] + b <= cap) {
        bins[i].push(b)
        sums[i] += b
        placed = true
        break
      }
    }
    if (!placed) {
      bins.push([b])
      sums.push(b)
    }
  }
  return bins
}

// balance boxes across pickup terminals
function divideBoxes(sizes: number[], n: number): number[][] {
  const bins: number[][] = Array.from({ length: n }, () => [])
  const sums = new Array(n).fill(0)
  for (const s of [...sizes].sort((a, b) => b - a)) {
    let bi = 0
    for (let i = 1; i < n; i++) if (sums[i] < sums[bi]) bi = i
    bins[bi].push(s)
    sums[bi] += s
  }
  return bins
}

export function buildRouteModel(
  contracts: HaulingContract[],
  locations: Location[],
  startLocation?: string,
  capacity?: number
): RouteModel {
  const nodes: RouteNode[] = []
  const byKey = new Map<string, number>()

  // forced start loads at depot
  const startLoc = startLocation ? matchLocation(startLocation, locations) : null
  let depot: number | undefined
  if (startLoc) {
    const split = splitDestination(startLoc.name)
    depot = nodes.length
    byKey.set('depot', depot)
    nodes.push({
      key: 'depot',
      label: startLoc.name,
      code: startLoc.code || split.code,
      region: split.region,
      uexId: startLoc.uexId,
      x: startLoc.x,
      y: startLoc.y,
      z: startLoc.z,
      system: startLoc.system,
      destStrings: []
    })
  }

  const nodeFor = (raw: string, isDest: boolean): number => {
    const loc = matchLocation(raw, locations)
    if (!isDest && depot !== undefined && sameLoc(loc, startLoc)) return depot
    const split = splitDestination(raw)
    // uexId 0 isn't unique
    const key = loc
      ? loc.uexId
        ? `uex:${loc.uexId}`
        : `loc:${norm(loc.name)}|${loc.system ?? ''}`
      : `raw:${norm(raw)}`
    let idx = byKey.get(key)
    if (idx === undefined) {
      idx = nodes.length
      byKey.set(key, idx)
      nodes.push({
        key,
        label: loc?.name || raw.trim(),
        code: loc?.code || split.code,
        region: split.region,
        uexId: loc?.uexId,
        x: loc?.x,
        y: loc?.y,
        z: loc?.z,
        system: loc?.system,
        destStrings: []
      })
    }
    if (isDest && !nodes[idx].destStrings.includes(raw)) nodes[idx].destStrings.push(raw)
    return idx
  }

  const jobs: RouteJob[] = []
  const jobInfo: JobInfo[] = []
  for (const c of activeContracts(contracts)) {
    for (const o of c.objectives) {
      if (o.delivered) continue
      const destNode = nodeFor(o.destination, true)
      // dedupe, repeats halve scu
      const rawPickups = o.pickups && o.pickups.length ? o.pickups : [c.pickup || '(unknown pickup)']
      const seenPu = new Set<string>()
      const pickups = rawPickups.filter((p) => {
        const k = norm(p)
        if (seenPu.has(k)) return false
        seenPu.add(k)
        return true
      })
      // real boxes per terminal
      const perPickup =
        pickups.length === 1 ? [boxList(o.boxes)] : divideBoxes(boxList(o.boxes), pickups.length)
      pickups.forEach((pu, i) => {
        const pickupNode = nodeFor(pu || '(unknown pickup)', false)
        if (pickupNode === destNode) return
        const boxes = perPickup[i]
        const addJob = (b: number[]): void => {
          const s = b.reduce((a, v) => a + v, 0)
          jobs.push({ pickup: pickupNode, dest: destNode, scu: s, boxes: b })
          jobInfo.push({ pickupNode, destNode, scu: s, boxes: b, commodity: o.commodity, contractId: c.id, objectiveId: o.id })
        }
        // split only when over capacity
        if (capacity && capacity > 0 && boxes.reduce((a, v) => a + v, 0) > capacity) {
          for (const chunk of chunkToCapacity(boxes, capacity)) addJob(chunk)
        } else {
          addJob(boxes)
        }
      })
    }
  }
  return { nodes, jobs, jobInfo, depot }
}

// gigameters, dwarfs any in-system hop
const GATE_HOP_GM = 50
const CROSS_SYSTEM_GM = 200

/** nxn travel-cost matrix in gigameters */
function buildDistMatrix(
  nodes: RouteNode[],
  locations: Location[]
): { dist: number[][]; usedReal: boolean } {
  const n = nodes.length
  const gates = gatewaysBySystem(locations)
  const nearestGate = (node: Pos): number | null => {
    const gs = gates.get(node.system)
    if (!gs || !gs.length) return null
    return Math.min(...gs.map((g) => dist3(node, g)))
  }
  // fallback when a node has no coords
  const groupCost = (a: RouteNode, b: RouteNode): number => {
    if (a.region && a.region === b.region) return 5
    const sa = systemOf(a.code)
    const sb = systemOf(b.code)
    if (sa && sa === sb) return 25
    if (sa && sb) return CROSS_SYSTEM_GM
    return 25
  }

  let usedReal = false
  const dist: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i]
      const b = nodes[j]
      let cost: number
      if (hasPos(a) && hasPos(b)) {
        if (a.system === b.system) {
          cost = dist3(a, b)
          usedReal = true
        } else {
          const ga = nearestGate(a)
          const gb = nearestGate(b)
          if (ga != null && gb != null) {
            cost = ga + GATE_HOP_GM + gb
            usedReal = true
          } else cost = CROSS_SYSTEM_GM
        }
      } else cost = groupCost(a, b)
      dist[i][j] = cost
      dist[j][i] = cost
    }
  }
  return { dist, usedReal }
}

export function computeRoutePlan(
  contracts: HaulingContract[],
  locations: Location[],
  capacity: number,
  startLocation?: string,
  bays?: CargoGrid[],
  manualOrder?: string[]
): RoutePlan | null {
  locations = withCityCoords(locations)
  const model = buildRouteModel(contracts, locations, startLocation, capacity)
  if (model.nodes.length < 2 || model.jobs.length === 0) return null
  const { dist, usedReal } = buildDistMatrix(model.nodes, locations)

  // pair city nodes with their LEO
  const nodeByName = new Map(model.nodes.map((n, i) => [norm(n.label), i]))
  const cityToLeo = new Map<number, number>()
  model.nodes.forEach((n, i) => {
    const leo = CITY_LEO[norm(n.label)]
    const leoIdx = leo ? nodeByName.get(norm(leo)) : undefined
    if (leoIdx !== undefined) cityToLeo.set(i, leoIdx)
  })

  // saved key order, new stops last
  let fixedOrder: number[] | undefined
  if (manualOrder && manualOrder.length) {
    const byKey = new Map(model.nodes.map((n, i) => [n.key, i]))
    const seq: number[] = []
    const used = new Set<number>()
    for (const key of manualOrder) {
      const idx = byKey.get(key)
      if (idx !== undefined && !used.has(idx)) {
        seq.push(idx)
        used.add(idx)
      }
    }
    for (let i = 0; i < model.nodes.length; i++) if (!used.has(i)) seq.push(i)
    fixedOrder = seq
  }

  const result = planRoute({
    n: model.nodes.length,
    jobs: model.jobs,
    dist,
    capacity,
    start: model.depot,
    bays,
    fixedOrder,
    cityToLeo
  })

  const refOf = (ji: number): StepRef => ({
    contractId: model.jobInfo[ji].contractId,
    objectiveId: model.jobInfo[ji].objectiveId,
    scu: model.jobInfo[ji].scu,
    boxes: [...model.jobInfo[ji].boxes]
  })
  // one ref per objective, chunks summed
  const aggregate = (jis: number[]): StepRef[] => {
    const by = new Map<string, StepRef>()
    for (const ji of jis) {
      const j = model.jobInfo[ji]
      const cur = by.get(j.objectiveId)
      if (cur) {
        cur.scu += j.scu
        cur.boxes = [...(cur.boxes ?? []), ...j.boxes]
      } else by.set(j.objectiveId, refOf(ji))
    }
    return [...by.values()]
  }

  const steps: RouteStep[] = result.stops.map((stop) => {
    const node = model.nodes[stop.node]
    const pickups: RouteLegItem[] = []
    const drops: RouteLegItem[] = []
    const deferSeen = new Set<string>()
    const deferRefs: StepRef[] = []
    for (const ji of stop.pickJobs) {
      const j = model.jobInfo[ji]
      pickups.push({ commodity: j.commodity, scu: j.scu, other: model.nodes[j.destNode].label })
    }
    for (const ji of stop.dropJobs) {
      const j = model.jobInfo[ji]
      drops.push({ commodity: j.commodity, scu: j.scu, other: model.nodes[j.pickupNode].label })
    }
    const loadRefs = aggregate(stop.pickJobs)
    const dropRefs = aggregate(stop.dropJobs)
    for (const ji of stop.deferJobs ?? []) {
      const j = model.jobInfo[ji]
      if (!deferSeen.has(j.objectiveId)) {
        deferSeen.add(j.objectiveId)
        deferRefs.push(refOf(ji))
      }
    }
    return {
      nodeKey: node.key,
      label: node.label,
      code: node.code,
      region: node.region,
      pickups,
      drops,
      loadRefs,
      dropRefs,
      deferRefs,
      loadAfter: stop.loadAfter,
      trip: stop.trip
    }
  })

  // delivery order follows drops
  const destOrder: string[] = []
  for (const stop of result.stops) {
    if (!stop.dropJobs.length) continue
    for (const s of model.nodes[stop.node].destStrings) if (!destOrder.includes(s)) destOrder.push(s)
  }
  for (const node of model.nodes) {
    for (const s of node.destStrings) if (!destOrder.includes(s)) destOrder.push(s)
  }

  // distinct stops, the drag sequence
  const stopKeys: string[] = []
  const keySeen = new Set<string>()
  for (const stop of result.stops) {
    const key = model.nodes[stop.node].key
    if (!keySeen.has(key)) {
      keySeen.add(key)
      stopKeys.push(key)
    }
  }

  const trips = result.stops.length ? Math.max(...result.stops.map((s) => s.trip)) + 1 : 0
  const first = steps[0]

  // scu aboard at trip 0's peak
  const trip1Scu: Record<string, number> = {}
  {
    const aboard = new Set<number>()
    let bestLoad = -1
    let peak = new Set<number>()
    for (const stop of result.stops) {
      if (stop.trip !== 0) break
      for (const ji of stop.dropJobs) aboard.delete(ji)
      for (const ji of stop.pickJobs) aboard.add(ji)
      if (stop.loadAfter > bestLoad) {
        bestLoad = stop.loadAfter
        peak = new Set(aboard)
      }
    }
    for (const ji of peak) {
      const o = model.jobInfo[ji].objectiveId
      trip1Scu[o] = (trip1Scu[o] ?? 0) + model.jobInfo[ji].scu
    }
  }
  const matchedObjectives = [...new Set(model.jobInfo.map((j) => j.objectiveId))]

  return {
    steps,
    destOrder,
    stopKeys,
    totalDistance: result.totalDistance,
    feasible: result.feasible,
    peakLoad: result.peakLoad,
    capacity,
    trips,
    startLoad: first?.loadAfter ?? 0,
    startStop: first?.label ?? '',
    method: result.method,
    reason: result.reason,
    usedRealDistance: usedReal,
    trip1Scu,
    matchedObjectives
  }
}

// unmatched returns Infinity, shows full
export function firstTripBudget(plan: RoutePlan): (objectiveId: string) => number {
  const matched = new Set(plan.matchedObjectives)
  return (id) => (matched.has(id) ? plan.trip1Scu[id] ?? 0 : Infinity)
}
