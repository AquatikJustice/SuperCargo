export interface ParsedTitle {
  rank: string
  haulType: string
  pickup: string
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

export function contractRef(index: number): string {
  return 'C' + String(index + 1).padStart(2, '0')
}
