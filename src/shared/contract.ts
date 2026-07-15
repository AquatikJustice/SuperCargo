import type { DeliveryObjective } from './types'

export interface ParsedTitle {
  rank: string
  haulType: string
  pickup: string
}

// CIG bug: multi-pickup single-drop hauls spawn ALL cargo at the last listed pickup
export function collapseLastPickup(o: DeliveryObjective): DeliveryObjective {
  if (!o.pickups || o.pickups.length < 2) return o
  // ocr sometimes leaks the destination into the pickup list; collapsing onto it would kill the route job
  const dest = o.destination.trim().toLowerCase()
  const real = o.pickups.filter((p) => p.trim().toLowerCase() !== dest)
  const last = real.length ? real[real.length - 1] : o.pickups[o.pickups.length - 1]
  return { ...o, originalPickups: o.originalPickups ?? o.pickups, pickups: [last] }
}

// a broken cross-system slot shows "LocationNAddress" in the details list and the objectives
// repeat another slot's name to cover for it; physically the cargo sits at the Pyro-side Nyx gate
const BROKEN_SLOT_LOCATION = 'Nyx Gateway (Pyro)'
const PLACEHOLDER_RE = /^(?:location|destination)\s*\d*\s*address\s*\d*$/i

/** broken-slot tokens survive parse and review verbatim, the collapse reads them */
export function isBrokenSlotToken(s: string): boolean {
  return PLACEHOLDER_RE.test(s.trim())
}

export function resolveBrokenPickups(o: DeliveryObjective): DeliveryObjective {
  if (!o.pickups || o.pickups.length < 2) return o
  const seen = new Set<string>()
  let changed = false
  const pickups = o.pickups.map((p) => {
    const k = p.trim().toLowerCase()
    if (PLACEHOLDER_RE.test(k) || seen.has(k)) {
      changed = true
      return BROKEN_SLOT_LOCATION
    }
    seen.add(k)
    return p
  })
  return changed ? { ...o, originalPickups: o.originalPickups ?? o.pickups, pickups } : o
}

export function applyPickupBug(o: DeliveryObjective): DeliveryObjective {
  return collapseLastPickup(resolveBrokenPickups(o))
}

export function restorePickups(o: DeliveryObjective): DeliveryObjective {
  if (!o.originalPickups) return o
  const { originalPickups, ...rest } = o
  return { ...rest, pickups: originalPickups }
}

// game logs cross-system drops as just "Pyro System", real station needs OCR
export function isSystemDestination(dest: string): boolean {
  return /^[a-z][a-z0-9 ]*\ssystem$/i.test(dest.trim())
}

export function cleanTitle(raw: string): string {
  return raw
    .replace(/<\/?EM[^>]*>/gi, '')
    .replace(/\[BP\]\*?/gi, '')
    .replace(/\[\s*\d+\s*rep\s*\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s:]+$/, '') // log appends a trailing ": "
    .trim()
}

export function hasBlueprintMarker(raw: string): boolean {
  return /\[BP\]/i.test(raw)
}

// tier can be anywhere, scan whole title
const RANKS = ['Trainee', 'Rookie', 'Junior', 'Experienced', 'Senior', 'Expert', 'Master']
const RANK_RE = new RegExp(`\\b(${RANKS.join('|')})\\b`, 'i')

function rankFromTitle(title: string, firstSegment: string): string {
  const m = RANK_RE.exec(title)
  if (m) return RANKS.find((r) => r.toLowerCase() === m[1].toLowerCase()) ?? m[1]
  // multi-word segment isn't a rank
  return /\s/.test(firstSegment) ? '' : firstSegment
}

export function parseContractTitle(raw: string): ParsedTitle {
  const title = cleanTitle(raw)
  const parts = title.split('|').map((p) => p.trim()).filter(Boolean)

  const rank = rankFromTitle(title, parts[0] ?? '')
  const haulType = parts[1] ?? ''
  let pickup = ''

  // only trust a pickup the title spells out; the side panel is the real source
  const third = parts[2] ?? ''
  const stripTail = (s: string): string => s.replace(/\[.*$/, '').trim()
  if (/>/.test(third)) {
    pickup = stripTail(third.split('>')[0])
  } else if (/^from\s+/i.test(third)) {
    pickup = stripTail(third.replace(/^from\s+/i, ''))
  }

  return { rank, haulType, pickup }
}

export function isHaulingGenerator(generator: string): boolean {
  return /haul/i.test(generator)
}

// in-game names where the humanized generator isn't right
const PARTY_NAMES: Record<string, string> = {
  covalex_hauling: 'Covalex'
}

export function contractParty(generator?: string): string {
  if (!generator) return ''
  const known = PARTY_NAMES[generator.toLowerCase()]
  if (known) return known
  return generator
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

export function contractRef(index: number): string {
  return 'C' + String(index + 1).padStart(2, '0')
}
