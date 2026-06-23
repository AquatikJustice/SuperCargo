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
  /** Game-file position + system, for local distance math. Undefined => unmatched. */
  x?: number
  y?: number
  z?: number
  system?: string
  /** raw destination strings (as stored on objectives) that resolve to this node. */
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

/** Points back at the objective handled at a stop, so the loading guide can resolve
 *  box counts + tells. */
export interface StepRef {
  contractId: string
  objectiveId: string
}

export interface RouteModel {
  nodes: RouteNode[]
  jobs: RouteJob[]
  jobInfo: JobInfo[]
  /** index of the start depot node, when a starting location is set. */
  depot?: number
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
  /** objectives loaded here (deduped), for the loading guide. */
  loadRefs: StepRef[]
  /** objectives delivered here (deduped), for the loading guide. */
  dropRefs: StepRef[]
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

/** System code prefix, e.g. "CRU-L1" / "Crusader" -> "CRU"/"". */
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
/** Straight-line distance in gigameters (game-file coords are meters). Star
 *  Citizen bodies don't orbit the star, so within a system this is accurate. */
function dist3(a: Pos, b: Pos): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / 1e9
}
/** Jump-gate stations per system, for pricing cross-system legs. */
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

/** Same physical place? Prefer the UEX id, fall back to name + system. */
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

  // Depot: where the run begins. Cargo whose pickup is the start location loads
  // here and rides along, and the solver is forced to start from it. The start's
  // own delivery (if any) stays a normal stop, visited later in the route.
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
    // A pickup at the start location loads at the depot, never as its own stop.
    if (!isDest && depot !== undefined && sameLoc(loc, startLoc)) return depot
    const split = splitDestination(raw)
    // Key by UEX terminal id when there is one; game-file locations (DCs, outposts)
    // share uexId 0, so key those by name or they'd all collide into one node.
    // Game-file locations share uexId 0; key by name + system so two same-named
    // gateways ("Nyx Gateway" in Stanton vs in Pyro) stay distinct nodes.
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
      // A delivery can load from several pickups (many-to-one hauls). Split its SCU
      // across them so the solver routes through every pickup before the drop; the
      // exact split is unknown, so spread it evenly. Dedupe first - the same terminal
      // listed twice would otherwise halve the SCU into two identical legs.
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
        jobs.push({ pickup: pickupNode, dest: destNode, scu })
        jobInfo.push({ pickupNode, destNode, scu, commodity: o.commodity, contractId: c.id, objectiveId: o.id })
      })
    }
  }
  return { nodes, jobs, jobInfo, depot }
}

// Jump transit + a fallback for a cross-system leg we can't gate-route. Both in
// gigameters, larger than any within-system hop so the solver batches a system
// before crossing.
const GATE_HOP_GM = 50
const CROSS_SYSTEM_GM = 200

/** nxn travel-cost matrix (gigameters). Same-system pairs are exact Cartesian
 *  distance; cross-system routes through each system's nearest jump gate; nodes
 *  without coordinates fall back to a body/system grouping estimate, kept on the
 *  same gigameter scale so it mixes cleanly. */
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
  // grouping estimate for a pair we can't place, on the gigameter scale.
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

/** Solve and shape into a RoutePlan. Distances are computed locally from the
 *  bundled game-file coordinates, so no network/token is involved. */
export function computeRoutePlan(
  contracts: HaulingContract[],
  locations: Location[],
  capacity: number,
  startLocation?: string
): RoutePlan | null {
  const model = buildRouteModel(contracts, locations, startLocation)
  if (model.nodes.length < 2 || model.jobs.length === 0) return null
  const { dist, usedReal } = buildDistMatrix(model.nodes, locations)
  const result = planRoute({ n: model.nodes.length, jobs: model.jobs, dist, capacity, start: model.depot })

  const steps: RouteStep[] = result.order.map((nodeIdx, k) => {
    const node = model.nodes[nodeIdx]
    const pickups: RouteLegItem[] = []
    const drops: RouteLegItem[] = []
    const loadSeen = new Set<string>()
    const dropSeen = new Set<string>()
    const loadRefs: StepRef[] = []
    const dropRefs: StepRef[] = []
    model.jobInfo.forEach((j) => {
      if (j.pickupNode === nodeIdx) {
        pickups.push({ commodity: j.commodity, scu: j.scu, other: model.nodes[j.destNode].label })
        if (!loadSeen.has(j.objectiveId)) {
          loadSeen.add(j.objectiveId)
          loadRefs.push({ contractId: j.contractId, objectiveId: j.objectiveId })
        }
      }
      if (j.destNode === nodeIdx) {
        drops.push({ commodity: j.commodity, scu: j.scu, other: model.nodes[j.pickupNode].label })
        // A multi-pickup delivery has one job per pickup, all dropping here; show it once.
        if (!dropSeen.has(j.objectiveId)) {
          dropSeen.add(j.objectiveId)
          dropRefs.push({ contractId: j.contractId, objectiveId: j.objectiveId })
        }
      }
    })
    return {
      nodeKey: node.key,
      label: node.label,
      code: node.code,
      region: node.region,
      pickups,
      drops,
      loadRefs,
      dropRefs,
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
