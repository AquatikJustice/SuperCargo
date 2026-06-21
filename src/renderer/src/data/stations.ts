// Destination-name parsing. Destination strings arrive complete from the
// game log or manual entry (e.g. "HUR-L5 High Course Station"), so we only split
// them into code + name and build a readable region label from the code prefix.
//
// IMPORTANT: freight-elevator availability is NOT looked up here. There is no
// API for it, and the earlier hard-coded values were placeholders copied from
// the design mockup. Curated station metadata (elevator access, ship access
// rules) is Phase 3. Until then `hasElevator` stays undefined and the manifest
// shows no elevator badge rather than guessing.

import { lookupStationMeta } from './stationMetadata'

const CODE_RE = /^([A-Z]{2,4}-[A-Z0-9]{1,4})\b\s*(.*)$/
const LAGRANGE_RE = /-(L[1-5])$/i

// Star Citizen body prefixes seen in station codes.
const BODY: Record<string, string> = {
  HUR: 'Hurston',
  CRU: 'Crusader',
  ARC: 'ArcCorp',
  MIC: 'microTech',
  PYR: 'Pyro'
}

export interface SplitDestination {
  code: string
  name: string
  region: string
  /** undefined = unknown (render no elevator badge). Phase 3. */
  hasElevator?: boolean
}

function regionFromCode(code: string): string {
  if (!code) return ''
  const body = BODY[code.slice(0, 3).toUpperCase()] ?? ''
  const lag = LAGRANGE_RE.exec(code)
  if (body && lag) return `${body} · ${lag[1].toUpperCase()} Lagrange Point`
  return body
}

/** Split a raw destination like "HUR-L5 High Course Station" into parts. */
export function splitDestination(raw: string): SplitDestination {
  const trimmed = raw.trim()
  const m = CODE_RE.exec(trimmed)
  const code = m ? m[1] : ''
  const name = m ? m[2] || trimmed : trimmed
  // Elevator flag comes only from curated metadata (Phase 3 / org data), never
  // guessed. undefined => no badge.
  const meta = lookupStationMeta(code, trimmed)
  return { code, name, region: regionFromCode(code), hasElevator: meta?.hasElevator }
}
