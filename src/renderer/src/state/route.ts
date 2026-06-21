// Renderer-side glue between the manifest and the pure route solver (@shared/route).
// Turns contracts into unique location nodes plus pickup/delivery jobs, builds a
// distance matrix (real UEX terminal distances where we have them, a system/body
// grouping cost otherwise), and shapes the solved order into UI steps plus a
// destination order the rest of the app can use.

import type { HaulingContract, Location } from '@shared/types'
import { planRoute, type RouteJob, type RouteResult } from '@shared/route'
import { splitDestination } from '../data/stations'
import { activeContracts } from './manifest'

export interface RouteNode {
  key: string
  label: string
  code: string
  region: string
  uexId?: number
  /** raw destination strings (as stored on objectives) that resolve to this node. */
  destStrings: string[]
}

interface JobInfo {
  pickupNode: number
  destNode: number
  scu: number
  commodity: string
}

export interface RouteModel {
  nodes: RouteNode[]
  jobs: RouteJob[]
  jobInfo: JobInfo[]
}

export interface RouteLegItem {
  commodity: string
  scu: number
  /** other end of this leg (destination for a pickup, origin for a drop). */
  other: string
}

export interface RouteStep {
  nodeKey: string
  label: string
  code: string
  region: string
  /** cargo loaded here. */
  pickups: RouteLegItem[]
  /** cargo delivered here. */
  drops: RouteLegItem[]
  /** SCU aboard after this stop. */
  loadAfter: number
}

export interface RoutePlan {
  steps: RouteStep[]
  /** ordered destination strings, for the manifest `order`. */
  destOrder: string[]
  totalDistance: number
  feasible: boolean
  peakLoad: number
  capacity: number
  method: RouteResult['method']
  reason?: string
  /** true when at least one leg used a real UEX distance (vs grouping fallback). */
  usedRealDistance: boolean
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Try to match a free pickup/destination string to a UEX Location. */
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
  // one name contains the other (e.g. "Baijini Point" vs "Baijini")
  const byContains = locations.find((l) => {
    const ln = norm(l.name)
    return ln.includes(n) || n.includes(ln)
  })
  return byContains ?? null
}

const pairKey = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`)

/** System code prefix, e.g. "CRU-L1" / "Crusader" -> "CRU"/"". */
function systemOf(code: string): string {
  const m = /^([A-Za-z]{3})\b/.exec(code)
  return m ? m[1].toUpperCase() : ''
}

export function buildRouteModel(
  contracts: HaulingContract[],
  locations: Location[]
): RouteModel {
  const nodes: RouteNode[] = []
  const byKey = new Map<string, number>()

  const nodeFor = (raw: string, isDest: boolean): number => {
    const loc = matchLocation(raw, locations)
    const split = splitDestination(raw)
    const key = loc ? `uex:${loc.uexId}` : `raw:${norm(raw)}`
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
      const pickupNode = nodeFor(c.pickup || '(unknown pickup)', false)
      const destNode = nodeFor(o.destination, true)
      if (pickupNode === destNode) continue
      jobs.push({ pickup: pickupNode, dest: destNode, scu: o.scuAmount })
      jobInfo.push({ pickupNode, destNode, scu: o.scuAmount, commodity: o.commodity })
    }
  }
  return { nodes, jobs, jobInfo }
}

/** nxn cost matrix: real UEX distances if every pair is covered, else a
 *  system/body grouping cost (mixing the two scales would distort the order). */
function buildDistMatrix(
  nodes: RouteNode[],
  matrix: Record<string, number>
): { dist: number[][]; usedReal: boolean } {
  const n = nodes.length
  // check if we have a real distance for every pair
  let allReal = true
  for (let i = 0; i < n && allReal; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i].uexId
      const b = nodes[j].uexId
      if (a == null || b == null || matrix[pairKey(a, b)] == null) {
        allReal = false
        break
      }
    }
  }
  const dist: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let cost: number
      if (allReal) {
        cost = matrix[pairKey(nodes[i].uexId as number, nodes[j].uexId as number)]
      } else {
        // grouping cost: same body cheap, same system medium, cross-system expensive
        const ri = nodes[i].region
        const rj = nodes[j].region
        const si = systemOf(nodes[i].code)
        const sj = systemOf(nodes[j].code)
        if (ri && rj && ri === rj) cost = 1
        else if (si && sj && si === sj) cost = 2
        else if (si && sj) cost = 8
        else cost = 5
      }
      dist[i][j] = cost
      dist[j][i] = cost
    }
  }
  return { dist, usedReal: allReal && n >= 2 }
}

/** Solve and shape into a RoutePlan. `distances` is the UEX pair matrix (may be {}). */
export function computeRoutePlan(
  contracts: HaulingContract[],
  locations: Location[],
  capacity: number,
  distances: Record<string, number>
): RoutePlan | null {
  const model = buildRouteModel(contracts, locations)
  if (model.nodes.length < 2 || model.jobs.length === 0) return null
  const { dist, usedReal } = buildDistMatrix(model.nodes, distances)
  const result = planRoute({ n: model.nodes.length, jobs: model.jobs, dist, capacity })

  const steps: RouteStep[] = result.order.map((nodeIdx, k) => {
    const node = model.nodes[nodeIdx]
    const pickups: RouteLegItem[] = []
    const drops: RouteLegItem[] = []
    model.jobInfo.forEach((j) => {
      if (j.pickupNode === nodeIdx)
        pickups.push({ commodity: j.commodity, scu: j.scu, other: model.nodes[j.destNode].label })
      if (j.destNode === nodeIdx)
        drops.push({ commodity: j.commodity, scu: j.scu, other: model.nodes[j.pickupNode].label })
    })
    return {
      nodeKey: node.key,
      label: node.label,
      code: node.code,
      region: node.region,
      pickups,
      drops,
      loadAfter: result.loadAfter[k] ?? 0
    }
  })

  const destOrder: string[] = []
  for (const nodeIdx of result.order) {
    for (const s of model.nodes[nodeIdx].destStrings) if (!destOrder.includes(s)) destOrder.push(s)
  }

  return {
    steps,
    destOrder,
    totalDistance: result.totalDistance,
    feasible: result.feasible,
    peakLoad: result.peakLoad,
    capacity,
    method: result.method,
    reason: result.reason,
    usedRealDistance: usedReal
  }
}

/** Terminal ids needed to price a manifest's route (for the distance prefetch). */
export function routeTerminalIds(contracts: HaulingContract[], locations: Location[]): number[] {
  const { nodes } = buildRouteModel(contracts, locations)
  return nodes.map((n) => n.uexId).filter((x): x is number => typeof x === 'number')
}
