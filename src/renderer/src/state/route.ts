// manifest -> route solver glue

import type { HaulingContract, Location } from '@shared/types'
import { planRoute, type RouteJob, type RouteResult } from '@shared/route'
import type { CargoGrid } from '@shared/cargoGrids'
import { boxList, calculateBoxes } from '@shared/box'
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
  commodity: string
  contractId: string
  objectiveId: string
}

export interface StepRef {
  contractId: string
  objectiveId: string
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
  /** dest if pickup, origin if drop */
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
  /** cargo here left for a return pass because the hold was full */
  deferRefs: StepRef[]
  loadAfter: number
  /** which trip this stop belongs to (0-based) */
  trip: number
}

export interface RoutePlan {
  steps: RouteStep[]
  destOrder: string[]
  /** distinct stops in visit order (node keys), what the user reorders */
  stopKeys: string[]
  totalDistance: number
  feasible: boolean
  peakLoad: number
  capacity: number
  /** number of hold-fulls; > 1 means revisits to stay under capacity */
  trips: number
  /** scu aboard leaving the first stop, i.e. what you carry right now */
  startLoad: number
  /** name of that first stop */
  startStop: string
  method: RouteResult['method']
  reason?: string
  /** real distance vs grouping fallback */
  usedRealDistance: boolean
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

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

/** 3-letter system prefix from a code */
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
/** gigameters; coords are meters, hence /1e9 */
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

/** match by uex id, else name + system */
function sameLoc(a: Location | null, b: Location | null): boolean {
  if (!a || !b) return false
  if (a.uexId && b.uexId) return a.uexId === b.uexId
  return norm(a.name) === norm(b.name) && (a.system ?? '') === (b.system ?? '')
}

export function buildRouteModel(
  contracts: HaulingContract[],
  locations: Location[],
  startLocation?: string
): RouteModel {
  const nodes: RouteNode[] = []
  const byKey = new Map<string, number>()

  // forced start; pickups here load at depot
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
    // uexId 0 isn't unique, so key those by name + system
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
      // dedupe first or a repeated pickup halves the scu
      const rawPickups = o.pickups && o.pickups.length ? o.pickups : [c.pickup || '(unknown pickup)']
      const seenPu = new Set<string>()
      const pickups = rawPickups.filter((p) => {
        const k = norm(p)
        if (seenPu.has(k)) return false
        seenPu.add(k)
        return true
      })
      const base = Math.floor(o.scuAmount / pickups.length)
      const rem = o.scuAmount - base * pickups.length
      pickups.forEach((pu, i) => {
        const pickupNode = nodeFor(pu || '(unknown pickup)', false)
        if (pickupNode === destNode) return
        const scu = base + (i < rem ? 1 : 0)
        // a single pickup carries the objective's own boxes; a split recomputes
        const boxes =
          pickups.length === 1 ? boxList(o.boxes) : boxList(calculateBoxes(scu, c.maxBoxSize))
        jobs.push({ pickup: pickupNode, dest: destNode, scu, boxes })
        jobInfo.push({ pickupNode, destNode, scu, commodity: o.commodity, contractId: c.id, objectiveId: o.id })
      })
    }
  }
  return { nodes, jobs, jobInfo, depot }
}

// gigameters; bigger than any in-system hop so solver batches by system
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
  const model = buildRouteModel(contracts, locations, startLocation)
  if (model.nodes.length < 2 || model.jobs.length === 0) return null
  const { dist, usedReal } = buildDistMatrix(model.nodes, locations)

  // turn the saved node-key order into a full node sequence; unknown/new stops
  // fall in at the end so nothing is lost
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
    fixedOrder
  })

  const refOf = (ji: number): StepRef => ({
    contractId: model.jobInfo[ji].contractId,
    objectiveId: model.jobInfo[ji].objectiveId
  })

  const steps: RouteStep[] = result.stops.map((stop) => {
    const node = model.nodes[stop.node]
    const pickups: RouteLegItem[] = []
    const drops: RouteLegItem[] = []
    const loadSeen = new Set<string>()
    const dropSeen = new Set<string>()
    const deferSeen = new Set<string>()
    const loadRefs: StepRef[] = []
    const dropRefs: StepRef[] = []
    const deferRefs: StepRef[] = []
    for (const ji of stop.pickJobs) {
      const j = model.jobInfo[ji]
      pickups.push({ commodity: j.commodity, scu: j.scu, other: model.nodes[j.destNode].label })
      if (!loadSeen.has(j.objectiveId)) {
        loadSeen.add(j.objectiveId)
        loadRefs.push(refOf(ji))
      }
    }
    for (const ji of stop.dropJobs) {
      const j = model.jobInfo[ji]
      drops.push({ commodity: j.commodity, scu: j.scu, other: model.nodes[j.pickupNode].label })
      if (!dropSeen.has(j.objectiveId)) {
        dropSeen.add(j.objectiveId)
        dropRefs.push(refOf(ji))
      }
    }
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

  // manifest delivery order follows where cargo actually drops
  const destOrder: string[] = []
  for (const stop of result.stops) {
    if (!stop.dropJobs.length) continue
    for (const s of model.nodes[stop.node].destStrings) if (!destOrder.includes(s)) destOrder.push(s)
  }
  for (const node of model.nodes) {
    for (const s of node.destStrings) if (!destOrder.includes(s)) destOrder.push(s)
  }

  // distinct stops in visit order - the sequence the user drags
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
    usedRealDistance: usedReal
  }
}

// the cargo in the hold at its fullest moment on the first trip - the snapshot
// the grid should draw, since that peak load is what decides whether everything
// fits. later trips and post-peak re-pickups fall away; cargo the route can't
// place (unmatched location) still passes so nothing silently vanishes.
export function firstTripFilter(plan: RoutePlan): (objectiveId: string) => boolean {
  const known = new Set<string>()
  for (const s of plan.steps) {
    for (const r of s.loadRefs) known.add(r.objectiveId)
    for (const r of s.dropRefs) known.add(r.objectiveId)
    for (const r of s.deferRefs) known.add(r.objectiveId)
  }
  // walk trip 0, dropping then loading at each stop, and keep the aboard set at
  // the heaviest moment. trips run in sequence, so stop at the first non-zero.
  const aboard = new Set<string>()
  let peak = new Set<string>()
  let peakLoad = -1
  for (const s of plan.steps) {
    if (s.trip !== 0) break
    for (const r of s.dropRefs) aboard.delete(r.objectiveId)
    for (const r of s.loadRefs) aboard.add(r.objectiveId)
    if (s.loadAfter >= peakLoad) {
      peakLoad = s.loadAfter
      peak = new Set(aboard)
    }
  }
  return (id) => !known.has(id) || peak.has(id)
}
