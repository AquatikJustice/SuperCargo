// the log writes addresses ("Rat's Nest at the L5 Lagrange of Pyro V"); the roster wants names

import type { Location } from './types'
import { isSystemDestination } from './contract'

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// the suffix isn't just garbage, its body names the system: the gateway disambiguator
const RE_ADDRESS =
  /^(.*?)\s+(?:at\s+the\s+L[1-5]\s+Lagrange\s+of|above|in\s+orbit\s+(?:of|around)|near|on)\s+([A-Za-z][A-Za-z ]*?)(?:\s+[IVXL]+)?\s*\.?$/i

const BODY_SYSTEM: Record<string, string> = {
  hurston: 'stanton',
  crusader: 'stanton',
  arccorp: 'stanton',
  microtech: 'stanton',
  stanton: 'stanton',
  pyro: 'pyro',
  nyx: 'nyx',
  terra: 'terra',
  magnus: 'magnus'
}

export function splitLogAddress(raw: string): { name: string; systemHint?: string } {
  const m = RE_ADDRESS.exec(raw.trim())
  if (!m || !m[1].trim()) return { name: raw.trim() }
  const body = norm(m[2]).split(' ')[0]
  return { name: m[1].trim(), systemHint: BODY_SYSTEM[body] }
}

/** resolve a log location string to its roster name; falls back to the culled name */
export function resolveLogLocation(raw: string, locations: Location[]): string {
  const trimmed = raw.trim()
  // bare-system drops stay bare, they gate the OCR capture
  if (!trimmed || isSystemDestination(trimmed) || !locations.length) return trimmed
  const { name, systemHint } = splitLogAddress(trimmed)
  const n = norm(name)
  if (!n) return trimmed

  const bySystem = (hits: Location[]): Location[] => {
    if (hits.length > 1 && systemHint) {
      const sys = hits.filter((l) => l.system === systemHint)
      if (sys.length) return sys
    }
    return hits
  }
  const untag = (s: string): string => s.replace(/\s*\([^)]*\)\s*$/, '')

  let hits = bySystem(locations.filter((l) => norm(l.name) === n))
  if (!hits.length) hits = bySystem(locations.filter((l) => norm(untag(l.name)) === n))
  if (!hits.length && n.length >= 4) {
    hits = bySystem(
      locations.filter((l) => {
        const ln = norm(untag(l.name))
        return ln.length >= 4 && (ln.includes(n) || n.includes(ln))
      })
    )
  }
  if (hits.length) return hits[0].name
  return name
}
