import type { HaulingContract, Location, MarkerPoint } from './types'
import { isSystemDestination } from './contract'
import { normalize } from './fuzzy'

export interface ResolvedDropoff {
  index: number
  z: number
  /** the location name when exactly one catalogued spot shares this Z, else null */
  location: string | null
  /** every catalogued name at this Z; length > 1 means the Z is ambiguous (e.g. the two Pyro gates) */
  candidates: string[]
}

// the game's marker Z equals the catalogued location Z to full float precision (X/Y are a
// different frame and don't join). float print rounding is well under a meter, so a tight window.
const Z_EPSILON = 1

export function locationByZ(z: number, locations: Location[]): { location: string | null; candidates: string[] } {
  const names = locations.filter((l) => typeof l.z === 'number' && Math.abs(l.z - z) < Z_EPSILON).map((l) => l.name)
  return { location: names.length === 1 ? names[0] : null, candidates: names }
}

export function resolveDropoffs(dropoffs: MarkerPoint[], locations: Location[]): ResolvedDropoff[] {
  return dropoffs.map((d) => {
    const { location, candidates } = locationByZ(d.z, locations)
    return { index: d.index, z: d.z, location, candidates }
  })
}

const unresolved = (dest: string): boolean => !dest || isSystemDestination(dest)

// per objective, the destination to fill in, or null to leave it. only fills a destination the
// game left unresolved (system-level or blank), and only when it's unambiguous: one open objective
// and one leftover uniquely-resolved marker location. a Z tie or a crowded contract just abstains.
export function backfillDestinations(
  destinations: string[],
  dropoffs: MarkerPoint[],
  locations: Location[]
): (string | null)[] {
  const out: (string | null)[] = destinations.map(() => null)
  if (!dropoffs.length || !locations.length) return out

  const resolved = resolveDropoffs(dropoffs, locations)
  const marked = [...new Set(resolved.map((r) => r.location).filter((n): n is string => !!n))]
  const taken = new Set(destinations.filter((d) => !unresolved(d)).map(normalize))
  const leftover = marked.filter((n) => !taken.has(normalize(n)))
  const holes = destinations.map((d, i) => (unresolved(d) ? i : -1)).filter((i) => i >= 0)

  if (holes.length === 1 && leftover.length === 1) out[holes[0]] = leftover[0]
  return out
}

// only log source for multi-pickup stops; a shared Z (both Pyro gates) comes back null
export function resolvePickups(pickups: MarkerPoint[], locations: Location[]): (string | null)[] {
  if (!locations.length) return pickups.map(() => null)
  return [...pickups]
    .sort((a, b) => a.index - b.index)
    .map((p) => locationByZ(p.z, locations).location)
}

// slot indices are per contract, so only a lone objective can claim the pickup markers
function pickupFill(c: HaulingContract, locations: Location[]): string[] | null {
  if (!c.markerPickups?.length || c.objectives.length !== 1 || c.objectives[0].pickups?.length) return null
  const names = resolvePickups(c.markerPickups, locations)
  return names.every((n): n is string => !!n) ? names : null
}

// recover stops the game logged as a bare system (or left blank) from the objective marker coords
export function applyMarkerBackfill(contracts: HaulingContract[], locations: Location[]): HaulingContract[] {
  if (!locations.length) return contracts
  let changed = false
  const next = contracts.map((c) => {
    if (!c.objectives.length) return c
    let objectives = c.objectives
    if (c.markerDropoffs?.length) {
      const fills = backfillDestinations(objectives.map((o) => o.destination), c.markerDropoffs, locations)
      if (fills.some((f) => f !== null)) {
        objectives = objectives.map((o, i) => (fills[i] ? { ...o, destination: fills[i] as string } : o))
      }
    }
    const pickups = pickupFill({ ...c, objectives }, locations)
    if (pickups) objectives = [{ ...objectives[0], pickups }]
    if (objectives === c.objectives) return c
    changed = true
    return { ...c, objectives, pickup: pickups?.length === 1 && !c.pickup ? pickups[0] : c.pickup }
  })
  return changed ? next : contracts
}
